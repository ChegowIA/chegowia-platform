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

/**
 * Vencimento sem webhook.
 *
 * O bloqueio do painel depende de a assinatura estar INADIMPLENTE, e quem marca
 * isso é o evento PAYMENT_OVERDUE. Com o webhook desativado — como esteve na
 * primeira validação — o cliente seguiria usando sem pagar, e o consumo de IA e
 * WhatsApp desse período é custo nosso, que não volta.
 */
describe("conciliação de mensalidade vencida", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function build(cobrancas: any[]) {
    const clientSubscription = {
      findMany: jest.fn().mockResolvedValue([
        { id: "sub-1", companyId: "empresa-1", asaasSubscriptionId: "sub_asaas_1" },
      ]),
      update: jest.fn().mockResolvedValue({}),
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      listSubscriptionPayments: jest.fn().mockResolvedValue(cobrancas),
    };
    const service = buildBillingService({ prisma: { clientSubscription }, asaas });
    service.onModuleDestroy();
    return { service, clientSubscription, asaas };
  }

  it("marca inadimplente quando o Asaas tem cobrança vencida", async () => {
    const { service, clientSubscription } = build([{ id: "pay_1", status: "OVERDUE", value: 5 }]);

    await (service as never as Record<string, any>).reconcileOverdueAsaasPayments();

    expect(clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "INADIMPLENTE" } }),
    );
  });

  it("não bloqueia quem só tem cobrança em aberto dentro do prazo", async () => {
    const { service, clientSubscription } = build([{ id: "pay_1", status: "PENDING", value: 5 }]);

    await (service as never as Record<string, any>).reconcileOverdueAsaasPayments();

    expect(clientSubscription.update).not.toHaveBeenCalled();
  });

  it("só considera assinatura ativa já fora do período pago", async () => {
    const { service, clientSubscription } = build([]);

    await (service as never as Record<string, any>).reconcileOverdueAsaasPayments();

    const filtro = clientSubscription.findMany.mock.calls[0][0].where;
    expect(filtro.status).toBe("ATIVA");
    expect(filtro.currentPeriodEnd.lt).toBeInstanceOf(Date);
  });
});

/**
 * A fatura de ativação sai com o valor total: mensalidade mais todo o consumo
 * faturável acumulado. Nunca duas cobranças.
 */
describe("consumo acumulado na fatura de ativação", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function build(pendentes: any[], overrides: { asaas?: any } = {}) {
    const prisma = {
      clientSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: "sub-1",
          companyId: "empresa-1",
          status: "EM_TESTE",
          trialEndsAt: new Date(Date.now() - 60_000),
          monthlyPriceSnapshot: 159.9,
          asaasCustomerId: "cus_1",
          asaasPaymentId: null,
          plan: { name: "Profissional", monthlyPrice: 159.9, currency: "brl" },
          reseller: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ email: "dono@loja.com.br", name: "Dono" }) },
      company: { findUnique: jest.fn().mockResolvedValue({ name: "Pizzaria", cnpj: "12345678000199" }) },
      usageLedger: {
        // A ativação lê o razão direto para incluir também o consumo do teste,
        // que `pendingBillableEntries` exclui de propósito.
        findMany: jest.fn().mockResolvedValue(pendentes),
        updateMany: jest.fn().mockResolvedValue({ count: pendentes.length }),
      },
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      createCustomer: jest.fn().mockResolvedValue({ id: "cus_1" }),
      createSubscription: jest.fn().mockResolvedValue({ id: "sub_asaas_1" }),
      listSubscriptionPayments: jest.fn().mockResolvedValue([
        { id: "pay_1", status: "PENDING", value: 159.9, invoiceUrl: "https://asaas.com/i/pay_1" },
      ]),
      updatePayment: jest.fn().mockResolvedValue({}),
      getPayment: jest.fn().mockResolvedValue({ id: "pay_1", status: "PENDING", value: 168.3, invoiceUrl: "https://asaas.com/i/pay_1" }),
      ...(overrides.asaas ?? {}),
    };
    const service = buildBillingService({ prisma, asaas });
    service.onModuleDestroy();
    return { service, asaas, prisma };
  }

  it("soma o consumo acumulado à cobrança da ativação", async () => {
    const { service, asaas } = build([
      { id: "u1", companyId: "empresa-1", metric: "IA_TOKENS_SAIDA", quantity: 5000, billableAmount: 6 },
      { id: "u2", companyId: "empresa-1", metric: "WHATSAPP_SERVICO", quantity: 20, billableAmount: 2.4 },
    ]);

    await service.companyCheckout("empresa-1");

    expect(asaas.updatePayment).toHaveBeenCalledWith("pay_1", expect.objectContaining({ value: 168.3 }));
    // O valor da assinatura fica intocado: o acréscimo não pode se repetir todo mês.
    expect(asaas.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ value: 159.9 }));
  });

  it("marca o consumo como sincronizado na cobrança da ativação", async () => {
    const { service, prisma } = build([
      { id: "u1", companyId: "empresa-1", metric: "IA_TOKENS_SAIDA", quantity: 5000, billableAmount: 6 },
    ]);

    await service.companyCheckout("empresa-1");

    expect(prisma.usageLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SINCRONIZADO", asaasPaymentId: "pay_1" } }),
    );
  });

  it("não altera a cobrança quando não há consumo pendente", async () => {
    const { service, asaas } = build([]);

    const result = await service.companyCheckout("empresa-1");

    expect(asaas.updatePayment).not.toHaveBeenCalled();
    expect(result).toEqual({ url: "https://asaas.com/i/pay_1", reused: false });
  });

  it("entrega o link mesmo se o acréscimo do consumo falhar", async () => {
    // Abortar a ativação por causa do acréscimo seria o pior desfecho: o cliente
    // quer pagar e o consumo entra na cobrança seguinte de qualquer forma.
    const { service } = build(
      [{ id: "u1", companyId: "empresa-1", metric: "IA_TOKENS_SAIDA", quantity: 5000, billableAmount: 6 }],
      { asaas: { updatePayment: jest.fn().mockRejectedValue(new Error("cobrança não editável")) } },
    );

    const result = await service.companyCheckout("empresa-1");

    expect(result).toEqual({ url: "https://asaas.com/i/pay_1", reused: false });
  });
});

/**
 * O consumo do teste é cobrado de quem assina e perdoado de quem desiste.
 *
 * A regra anterior era o oposto — o teste ficava por conta da ChegowIA — e estava
 * escrita em seis telas, incluindo as páginas públicas de venda. Este teste fixa
 * o comportamento e guarda o texto, porque promessa de preço em página pública
 * não pode divergir do que o código cobra.
 */
describe("consumo do teste na ativação", () => {
  it("inclui na fatura o consumo marcado como do teste", async () => {
    const prisma = {
      clientSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: "sub-1",
          companyId: "empresa-1",
          status: "EM_TESTE",
          trialEndsAt: new Date(Date.now() - 60_000),
          monthlyPriceSnapshot: 159.9,
          asaasCustomerId: "cus_1",
          asaasPaymentId: null,
          plan: { name: "Profissional", monthlyPrice: 159.9, currency: "brl" },
          reseller: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ email: "dono@loja.com.br", name: "Dono" }) },
      company: { findUnique: jest.fn().mockResolvedValue({ name: "Pizzaria", cnpj: "12345678000199" }) },
      usageLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "u1",
            companyId: "empresa-1",
            metric: "IA_TOKENS_SAIDA",
            quantity: 5000,
            billableAmount: 4.1,
            trialCoveredAt: new Date(),
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      createCustomer: jest.fn(),
      createSubscription: jest.fn().mockResolvedValue({ id: "sub_asaas_1" }),
      listSubscriptionPayments: jest.fn().mockResolvedValue([
        { id: "pay_1", status: "PENDING", value: 159.9, invoiceUrl: "https://asaas.com/i/pay_1" },
      ]),
      updatePayment: jest.fn().mockResolvedValue({}),
      getPayment: jest.fn().mockResolvedValue({ id: "pay_1", value: 164, invoiceUrl: "https://asaas.com/i/pay_1" }),
    };
    process.env.BILLING_PROVIDER = "ASAAS";
    const service = buildBillingService({ prisma, asaas });
    service.onModuleDestroy();

    await service.companyCheckout("empresa-1");

    expect(asaas.updatePayment).toHaveBeenCalledWith("pay_1", expect.objectContaining({ value: 164 }));
    // A consulta não filtra por trialCoveredAt: é isso que traz o gasto do teste.
    expect(prisma.usageLedger.findMany.mock.calls[0][0].where.trialCoveredAt).toBeUndefined();
    delete process.env.BILLING_PROVIDER;
  });

  it("a rotina mensal continua ignorando o consumo do teste", () => {
    // Quem não assina não paga: fora da ativação, o gasto do teste nunca entra em
    // cobrança. É `pendingBillableEntries` que garante isso.
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const fonte = readFileSync(join(__dirname, "..", "src", "usage", "usage.service.ts"), "utf8");
    const trecho = fonte.slice(fonte.indexOf("async pendingBillableEntries"));
    expect(trecho.slice(0, trecho.indexOf("}\n"))).toContain("trialCoveredAt: null");
  });

  it("as telas públicas não prometem mais que o teste é por conta da ChegowIA", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const raiz = join(__dirname, "..", "..", "..");
    const telas = [
      "apps/web/src/app/planos/page.tsx",
      "apps/web/src/app/software/page.tsx",
      "apps/web/src/app/painel/assinatura/page.tsx",
      "apps/web/src/app/revendedor/clientes/page.tsx",
    ];
    for (const tela of telas) {
      const conteudo = readFileSync(join(raiz, tela), "utf8");
      expect(conteudo).not.toMatch(/cobert[oa]s? pela ChegowIA/);
      expect(conteudo).not.toMatch(/por conta da ChegowIA/);
    }
  });
});

/**
 * As rotinas de conciliação rodam a cada 5 segundos, mas o que elas observam muda
 * em horas. Sem intervalo próprio, uma única empresa fora do período pago geraria
 * centenas de chamadas por hora à API do Asaas até pagar.
 */
describe("intervalo entre conferências", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("não reconsulta o vencimento da mesma assinatura a cada rodada", async () => {
    const prisma = {
      clientSubscription: {
        findMany: jest.fn().mockResolvedValue([
          { id: "sub-1", companyId: "empresa-1", asaasSubscriptionId: "sub_asaas_1" },
        ]),
        update: jest.fn(),
      },
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      listSubscriptionPayments: jest.fn().mockResolvedValue([{ id: "pay_1", status: "PENDING", value: 5 }]),
    };
    const service = buildBillingService({ prisma, asaas });
    service.onModuleDestroy();

    await (service as never as Record<string, any>).reconcileOverdueAsaasPayments();
    await (service as never as Record<string, any>).reconcileOverdueAsaasPayments();
    await (service as never as Record<string, any>).reconcileOverdueAsaasPayments();

    expect(asaas.listSubscriptionPayments).toHaveBeenCalledTimes(1);
  });

  it("não reconsulta a mesma cobrança de consumo a cada rodada", async () => {
    const prisma = {
      usageLedger: {
        findMany: jest.fn().mockResolvedValue([{ asaasPaymentId: "pay_1" }]),
        updateMany: jest.fn(),
      },
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      findPayment: jest.fn().mockResolvedValue({ id: "pay_1", status: "PENDING", value: 5 }),
    };
    const service = buildBillingService({ prisma, asaas });
    service.onModuleDestroy();

    await (service as never as Record<string, any>).reconcileOrphanUsage();
    await (service as never as Record<string, any>).reconcileOrphanUsage();

    expect(asaas.findPayment).toHaveBeenCalledTimes(1);
  });
});
