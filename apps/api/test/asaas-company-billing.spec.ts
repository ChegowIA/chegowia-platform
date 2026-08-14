import { BadRequestException } from "@nestjs/common";
import { buildBillingService } from "./support/messaging-services";

describe("fatura atual da empresa no Asaas", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_ENFORCEMENT = "true";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function build(status: "ATIVA" | "INADIMPLENTE", payments: any[], usageSummary: Record<string, number> = { estimatedTotal: 0 }) {
    const now = new Date();
    const currentPeriodEnd = new Date(now);
    currentPeriodEnd.setDate(currentPeriodEnd.getDate() + (status === "ATIVA" ? 10 : -1));
    const subscription = {
      id: "sub-local-1",
      companyId: "empresa-1",
      status,
      currentPeriodStart: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      currentPeriodEnd,
      asaasSubscriptionId: "sub_asaas_1",
      asaasCustomerId: "cus_1",
      asaasPaymentId: null,
      asaasPeriodPaymentId: "pay_periodo_anterior",
      stripeCustomerId: null,
      monthlyPriceSnapshot: 5,
      trialStartedAt: null,
      trialEndsAt: null,
      canceledAt: null,
      plan: { name: "Profissional", monthlyPrice: 5, currency: "brl" },
      reseller: null,
    };
    const clientSubscription = {
      findUnique: jest.fn().mockResolvedValue(subscription),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    };
    const usage = { getBillingUsage: jest.fn().mockResolvedValue(usageSummary) };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      listSubscriptionPayments: jest.fn().mockResolvedValue(payments),
    };
    const usageLedger = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
    const service = buildBillingService({ prisma: { clientSubscription, usageLedger }, usage, asaas });
    service.onModuleDestroy();
    return { service, asaas, clientSubscription };
  }

  it("não trata a próxima cobrança pendente como fatura pagável em ciclo ativo", async () => {
    const { service, asaas } = build("ATIVA", [
      { id: "pay_proxima", status: "PENDING", dueDate: "2099-01-01", value: 5, invoiceUrl: "https://asaas.test/proxima" },
    ]);

    const status = await service.companyBillingStatus("empresa-1");

    expect(status).toMatchObject({ status: "ATIVA", payableInvoice: null });
    expect(asaas.listSubscriptionPayments).not.toHaveBeenCalled();
    await expect(service.companyPortal("empresa-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("mostra a próxima mensalidade somada ao consumo sem reapresentá-la como dívida atual", async () => {
    const { service } = build("ATIVA", [], {
      estimatedTotal: 0.08,
      variableOutstandingCharged: 0.08,
    });

    const status = await service.companyBillingStatus("empresa-1");

    expect(status).toMatchObject({
      status: "ATIVA",
      nextBillingEstimate: {
        monthlyPrice: 5,
        variableAmount: 0.08,
        estimatedTotal: 5.08,
      },
    });
  });

  it("oferece exclusivamente a fatura vencida quando há inadimplência", async () => {
    const vencida = { id: "pay_vencida", status: "OVERDUE", dueDate: "2020-01-01", value: 6.2, invoiceUrl: "https://asaas.test/vencida" };
    const { service } = build("INADIMPLENTE", [
      { id: "pay_proxima", status: "PENDING", dueDate: "2099-01-01", value: 5, invoiceUrl: "https://asaas.test/proxima" },
      vencida,
    ]);

    const status = await service.companyBillingStatus("empresa-1");

    expect(status.payableInvoice).toEqual({
      id: "pay_vencida",
      url: "https://asaas.test/vencida",
      dueDate: "2020-01-01",
      value: 6.2,
    });
    await expect(service.companyPortal("empresa-1")).resolves.toEqual({ url: "https://asaas.test/vencida" });
  });

  it("recupera uma renovação recorrente paga mesmo se o webhook não chegar", async () => {
    const { service, clientSubscription } = build("INADIMPLENTE", [
      {
        id: "pay_renovacao",
        status: "RECEIVED",
        dueDate: "2099-01-01",
        value: 5,
        subscription: "sub_asaas_1",
      },
    ]);

    const status = await service.companyBillingStatus("empresa-1");

    expect(status).toMatchObject({ status: "ATIVA", accessRestricted: false, payableInvoice: null });
    expect(clientSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "ATIVA",
        asaasPeriodPaymentId: "pay_renovacao",
        currentPeriodStart: expect.any(Date),
        currentPeriodEnd: expect.any(Date),
      }),
    }));
  });
});
