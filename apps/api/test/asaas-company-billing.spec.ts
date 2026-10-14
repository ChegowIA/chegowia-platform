import { BadGatewayException, BadRequestException, NotFoundException } from "@nestjs/common";
import { CompaniesService } from "../src/companies/companies.service";
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
      getSubscription: jest.fn().mockResolvedValue({ id: "sub_asaas_1", value: 5, billingType: "PIX" }),
      listSubscriptionPayments: jest.fn().mockResolvedValue(payments),
    };
    const usageLedger = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
    // A tela precisa saber se a empresa está ativa para avisar quem entra por
    // acesso de suporte numa conta desativada.
    const company = { findUnique: jest.fn().mockResolvedValue({ isActive: true }) };
    const service = buildBillingService({ prisma: { clientSubscription, usageLedger, company }, usage, asaas });
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

/**
 * Desativar empresa e a assinatura.
 *
 * Desativar no super admin tirava a loja do ar e barrava o acesso, mas a
 * assinatura seguia viva no provedor: o lojista ficava sem acesso e pagando.
 * Agora a desativação encerra a cobrança primeiro — e se o provedor recusar, a
 * desativação não acontece, porque o pior dos dois lados é justamente sem
 * acesso e cobrando.
 */
describe("desativação de empresa e assinatura", () => {
  function build(overrides: any = {}) {
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({ id: "emp-1", name: "Loja" }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "emp-1", ...data })),
      },
    };
    const billing = {
      cancelCompanySubscription: overrides.cancel
        ?? jest.fn().mockResolvedValue({ status: "CANCELADA" }),
    };
    const service: any = Object.create(CompaniesService.prototype);
    service.prisma = prisma;
    service.db = () => prisma;
    service.billing = billing;
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.findById = jest.fn().mockResolvedValue({ id: "emp-1" });
    return { service, prisma, billing };
  }

  it("desativar encerra a assinatura no provedor", async () => {
    const { service, prisma, billing } = build();

    await service.setActive("emp-1", false);

    expect(billing.cancelCompanySubscription).toHaveBeenCalledWith("emp-1", { imediato: true });
    expect(prisma.company.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { isActive: false },
    }));
  });

  it("provedor recusando o cancelamento impede a desativação", async () => {
    const { service, prisma } = build({
      cancel: jest.fn().mockRejectedValue(new BadGatewayException("Asaas fora do ar")),
    });

    await expect(service.setActive("emp-1", false)).rejects.toThrow(/Asaas fora do ar/);
    // Sem acesso e ainda cobrando seria o pior resultado possível.
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("empresa que nunca contratou pode ser desativada", async () => {
    const { service, prisma } = build({
      cancel: jest.fn().mockRejectedValue(new NotFoundException("Assinatura não encontrada para esta empresa.")),
    });

    await expect(service.setActive("emp-1", false)).resolves.toMatchObject({ isActive: false });
    expect(prisma.company.update).toHaveBeenCalled();
  });

  it("reativar não mexe na assinatura", async () => {
    const { service, billing } = build();

    await service.setActive("emp-1", true);

    expect(billing.cancelCompanySubscription).not.toHaveBeenCalled();
  });
});

/**
 * Cancelamento imediato pelo super admin.
 *
 * Cancelar a pedido do lojista preserva o período já pago. Na desativação pelo
 * super admin isso deixaria a assinatura marcada como ATIVA numa conta em que
 * ninguém consegue entrar — foi o que apareceu no painel.
 */
describe("cancelamento imediato de assinatura", () => {
  function build() {
    const subscription = {
      id: "sub-1",
      companyId: "emp-1",
      status: "ATIVA",
      // Ainda há período pago pela frente: é justamente o caso que preservava.
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      asaasSubscriptionId: "sub_asaas_1",
      stripeSubscriptionId: null,
    };
    const clientSubscription = {
      findUnique: jest.fn().mockResolvedValue(subscription),
      update: jest.fn().mockResolvedValue({}),
    };
    const asaas = { cancelSubscription: jest.fn().mockResolvedValue({}) };
    const service = buildBillingService({ prisma: { clientSubscription }, asaas });
    service.onModuleDestroy();
    return { service, clientSubscription, asaas };
  }

  it("imediato marca a assinatura como cancelada mesmo com período pago em curso", async () => {
    const { service, clientSubscription } = build();

    const resultado = await service.cancelCompanySubscription("emp-1", { imediato: true });

    expect(resultado.scheduled).toBe(false);
    expect(clientSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELADA" }),
    }));
  });

  it("a pedido do lojista o período pago continua valendo", async () => {
    const { service, clientSubscription } = build();

    const resultado = await service.cancelCompanySubscription("emp-1");

    expect(resultado.scheduled).toBe(true);
    expect(clientSubscription.update.mock.calls[0][0].data.status).toBeUndefined();
  });
});
