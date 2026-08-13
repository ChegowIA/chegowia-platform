import { BadRequestException } from "@nestjs/common";
import { buildBillingService } from "./support/messaging-services";

/**
 * Ativação pós-teste pelo Asaas. Os dois provedores convivem: quem já assinou no
 * Stripe continua nele, e a chave de ambiente decide quem atende contratação
 * nova. Estes testes fixam o desvio e as condições que o Asaas impõe e o Stripe
 * não — principalmente o CNPJ, sem o qual não há como emitir cobrança.
 */
describe("ativação pelo Asaas", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const assinatura = {
    id: "sub-1",
    companyId: "empresa-1",
    status: "EM_TESTE",
    trialEndsAt: new Date(Date.now() - 60_000),
    monthlyPriceSnapshot: 159.9,
    asaasCustomerId: null,
    asaasPaymentId: null,
    plan: { name: "Profissional", monthlyPrice: 159.9, currency: "brl" },
    reseller: null,
  };

  function build(overrides: { company?: any; asaas?: any; admin?: any } = {}) {
    const prisma = {
      clientSubscription: {
        findUnique: jest.fn().mockResolvedValue(assinatura),
        update: jest.fn().mockResolvedValue(assinatura),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(
          "admin" in overrides ? overrides.admin : { email: "dono@loja.com.br", name: "Dono" },
        ),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue(
          "company" in overrides ? overrides.company : { name: "Pizzaria", cnpj: "12.345.678/0001-99", phone: "62999" },
        ),
      },
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      createCustomer: jest.fn().mockResolvedValue({ id: "cus_1" }),
      createSubscription: jest.fn().mockResolvedValue({ id: "sub_asaas_1" }),
      listSubscriptionPayments: jest.fn().mockResolvedValue([
        { id: "pay_1", invoiceUrl: "https://asaas.com/i/pay_1", status: "PENDING" },
      ]),
      getPayment: jest.fn(),
      ...(overrides.asaas ?? {}),
    };
    const service = buildBillingService({ prisma, asaas });
    service.onModuleDestroy();
    return { service, prisma, asaas };
  }

  it("cria cliente e assinatura no Asaas e devolve o link da cobrança", async () => {
    const { service, asaas, prisma } = build();

    const result = await service.companyCheckout("empresa-1");

    expect(asaas.createCustomer).toHaveBeenCalledWith(
      // O documento vai sem máscara: o Asaas recusa pontuação.
      expect.objectContaining({ cpfCnpj: "12345678000199", email: "dono@loja.com.br" }),
    );
    expect(asaas.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", value: 159.9 }),
    );
    expect(result).toEqual({ url: "https://asaas.com/i/pay_1", reused: false });
    expect(prisma.clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ asaasSubscriptionId: "sub_asaas_1" }) }),
    );
  });

  it("reaproveita a cobrança em aberto em vez de gerar outra a cada clique", async () => {
    const { service, asaas } = build({
      asaas: {
        getPayment: jest.fn().mockResolvedValue({
          id: "pay_1",
          status: "PENDING",
          invoiceUrl: "https://asaas.com/i/pay_1",
        }),
      },
    });
    (service as never as Record<string, any>).db().clientSubscription.findUnique.mockResolvedValue({
      ...assinatura,
      asaasPaymentId: "pay_1",
    });

    const result = await service.companyCheckout("empresa-1");

    expect(result).toEqual({ url: "https://asaas.com/i/pay_1", reused: true });
    expect(asaas.createSubscription).not.toHaveBeenCalled();
  });

  it("recusa sem CNPJ, que o Asaas exige para emitir cobrança", async () => {
    const { service, asaas } = build({ company: { name: "Pizzaria", cnpj: null } });

    await expect(service.companyCheckout("empresa-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });

  it("recusa sem administrador, cujo e-mail identifica o cliente na cobrança", async () => {
    const { service, asaas } = build({ admin: null });

    await expect(service.companyCheckout("empresa-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });

  it("não desvia para o Asaas quando a chave de ambiente aponta o Stripe", async () => {
    process.env.BILLING_PROVIDER = "STRIPE";
    const { service, asaas } = build();

    // O caminho do Stripe pode falhar ou responder dependendo do ambiente; o que
    // este teste garante é que o desvio não aconteceu.
    await service.companyCheckout("empresa-1").catch(() => undefined);

    expect(asaas.createSubscription).not.toHaveBeenCalled();
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
});

/**
 * Cobrança paga cujo acesso não foi liberado.
 *
 * Aconteceu de verdade na primeira validação: o webhook estava desativado no
 * painel, o cliente pagou e o painel continuou bloqueado. Pior que o bloqueio era
 * o botão — clicar de novo criava uma segunda assinatura e cobrava outra vez,
 * porque o código só reaproveitava a cobrança enquanto ela estivesse em aberto.
 */
describe("conciliação de cobrança paga sem ativação", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const assinatura = {
    id: "sub-1",
    companyId: "empresa-1",
    status: "EM_TESTE",
    trialEndsAt: new Date(Date.now() - 60_000),
    monthlyPriceSnapshot: 5,
    asaasCustomerId: "cus_1",
    asaasSubscriptionId: "sub_asaas_1",
    asaasPaymentId: "pay_1",
    plan: { name: "Profissional", monthlyPrice: 5, currency: "brl" },
    reseller: null,
    resellerId: null,
    discountEndsAt: null,
  };

  function build(status: string) {
    const clientSubscription = {
      findUnique: jest.fn().mockResolvedValue(assinatura),
      findMany: jest.fn().mockResolvedValue([
        { id: "sub-1", companyId: "empresa-1", asaasPaymentId: "pay_1", asaasSubscriptionId: "sub_asaas_1" },
      ]),
      update: jest.fn().mockResolvedValue({}),
    };
    const prisma = {
      clientSubscription,
      user: { findFirst: jest.fn().mockResolvedValue({ email: "dono@loja.com.br", name: "Dono" }) },
      company: { findUnique: jest.fn().mockResolvedValue({ name: "Pizzaria", cnpj: "12345678000199" }) },
      usageLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      commissionLedger: { upsert: jest.fn(), updateMany: jest.fn() },
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPayment: jest.fn().mockResolvedValue({ id: "pay_1", status, value: 5, subscription: "sub_asaas_1", customer: "cus_1" }),
      createCustomer: jest.fn(),
      createSubscription: jest.fn(),
      listSubscriptionPayments: jest.fn().mockResolvedValue([]),
    };
    const service = buildBillingService({ prisma, asaas });
    service.onModuleDestroy();
    return { service, asaas, clientSubscription };
  }

  it.each(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"])(
    "ativa em vez de cobrar de novo quando a cobrança está %s",
    async (status) => {
      const { service, asaas, clientSubscription } = build(status);

      const result = await service.companyCheckout("empresa-1");

      expect(asaas.createSubscription).not.toHaveBeenCalled();
      expect(result).toEqual({ activated: true, reused: true });
      expect(clientSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "ATIVA" }) }),
      );
    },
  );

  it("devolve o link quando a cobrança segue em aberto", async () => {
    const { service, asaas } = build("PENDING");
    asaas.getPayment.mockResolvedValue({ id: "pay_1", status: "PENDING", invoiceUrl: "https://asaas.com/i/pay_1" });

    const result = await service.companyCheckout("empresa-1");

    expect(result).toEqual({ url: "https://asaas.com/i/pay_1", reused: true });
    expect(asaas.createSubscription).not.toHaveBeenCalled();
  });

  it("a rotina de fundo libera o acesso mesmo se o webhook nunca chegar", async () => {
    const { service, clientSubscription } = build("RECEIVED");

    await (service as never as Record<string, any>).reconcilePendingAsaasPayments();

    expect(clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ATIVA" }) }),
    );
  });

  it("a rotina de fundo não toca em cobrança ainda em aberto", async () => {
    const { service, clientSubscription } = build("PENDING");

    await (service as never as Record<string, any>).reconcilePendingAsaasPayments();

    expect(clientSubscription.update).not.toHaveBeenCalled();
  });
});
