import { buildBillingService } from "./support/messaging-services";

/**
 * Consumo variável e cancelamento no Asaas.
 *
 * Não existe item de fatura como na Stripe: o que há é a cobrança da assinatura,
 * ainda em aberto, cujo valor pode ser alterado. Somar o consumo a ela mantém uma
 * cobrança só por mês, mas exige cuidado com o dobro — por isso cada lançamento
 * sai da fila ao ser somado, e o novo valor parte do valor atual da cobrança, não
 * do preço do plano.
 */
describe("consumo variável e cancelamento no Asaas", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const lancamentos = [
    { id: "u1", companyId: "empresa-1", metric: "IA_TOKENS_ENTRADA", quantity: 1200, billableAmount: 0.42 },
    { id: "u2", companyId: "empresa-1", metric: "WHATSAPP_MENSAGEM", quantity: 30, billableAmount: 1.08 },
  ];

  function build(overrides: { subscription?: any; asaas?: any; pending?: any[] } = {}) {
    const usageLedger = { updateMany: jest.fn().mockResolvedValue({ count: 2 }) };
    const clientSubscription = {
      findUnique: jest.fn().mockResolvedValue(
        "subscription" in overrides
          ? overrides.subscription
          : { asaasSubscriptionId: "sub_1", asaasCustomerId: "cus_1", status: "ATIVA" },
      ),
      update: jest.fn().mockResolvedValue({}),
    };
    const prisma = { usageLedger, clientSubscription };
    const usage = {
      pendingBillableEntries: jest.fn().mockResolvedValue(overrides.pending ?? lancamentos),
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      listSubscriptionPayments: jest.fn().mockResolvedValue([
        { id: "pay_1", status: "PENDING", value: 159.9, dueDate: "2026-09-05", invoiceUrl: "https://asaas.com/i/pay_1" },
      ]),
      updatePayment: jest.fn().mockResolvedValue({}),
      createPayment: jest.fn().mockResolvedValue({ id: "pay_uso", status: "PENDING", value: 6 }),
      findPaymentByReference: jest.fn().mockResolvedValue(null),
      cancelSubscription: jest.fn().mockResolvedValue({}),
      ...(overrides.asaas ?? {}),
    };
    const service = buildBillingService({ prisma, usage, asaas });
    service.onModuleDestroy();
    return { service, asaas, usageLedger, clientSubscription };
  }

  describe("consumo somado à cobrança em aberto", () => {
    it("soma o consumo ao valor atual da cobrança", async () => {
      const { service, asaas } = build();

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(asaas.updatePayment).toHaveBeenCalledWith("pay_1", expect.objectContaining({ value: 161.4 }));
    });

    it("tira os lançamentos da fila marcando qual cobrança os absorveu", async () => {
      const { service, usageLedger } = build();

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(usageLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "SINCRONIZADO", asaasPaymentId: "pay_1" },
          where: expect.objectContaining({ id: { in: ["u1", "u2"] }, trialCoveredAt: null }),
        }),
      );
    });

    it("não altera cobrança já paga", async () => {
      const { service, asaas } = build({
        asaas: {
          listSubscriptionPayments: jest.fn().mockResolvedValue([
            { id: "pay_1", status: "RECEIVED", value: 159.9, dueDate: "2026-08-05" },
          ]),
        },
      });

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(asaas.updatePayment).not.toHaveBeenCalled();
    });

    it("ignora empresa cuja assinatura não está ativa", async () => {
      const { service, asaas } = build({ subscription: { asaasSubscriptionId: "sub_1", status: "INADIMPLENTE" } });

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(asaas.listSubscriptionPayments).not.toHaveBeenCalled();
    });

    it("mantém os lançamentos pendentes quando o Asaas recusa a alteração", async () => {
      const { service, usageLedger } = build({
        asaas: { updatePayment: jest.fn().mockRejectedValue(new Error("cobrança não editável")) },
      });

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(usageLedger.updateMany).not.toHaveBeenCalled();
    });

    it("marca o consumo como faturado quando a cobrança é paga", async () => {
      const { service, usageLedger } = build();

      await (service as never as Record<string, any>).markAsaasUsagePaid("pay_1");

      expect(usageLedger.updateMany).toHaveBeenCalledWith({
        where: { asaasPaymentId: "pay_1", status: "SINCRONIZADO" },
        data: { status: "FATURADO" },
      });
    });
  });

  describe("cancelamento pedido pela empresa", () => {
    it("encerra a assinatura no Asaas e registra a data", async () => {
      const { service, asaas, clientSubscription } = build();
      clientSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        status: "ATIVA",
        asaasSubscriptionId: "sub_1",
        currentPeriodEnd: null,
      });

      const result = await service.cancelCompanySubscription("empresa-1");

      expect(asaas.cancelSubscription).toHaveBeenCalledWith("sub_1");
      expect(clientSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "CANCELADA" }) }),
      );
      expect(result.status).toBe("CANCELADA");
    });

    it("preserva o acesso até o fim do período já pago", async () => {
      const fim = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const { service, clientSubscription } = build();
      clientSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        status: "ATIVA",
        asaasSubscriptionId: "sub_1",
        currentPeriodEnd: fim,
      });

      const result = await service.cancelCompanySubscription("empresa-1");

      // Cancelar não devolve dinheiro: cortar na hora tiraria algo já pago.
      expect(clientSubscription.update.mock.calls[0][0].data.status).toBeUndefined();
      expect(result.scheduled).toBe(true);
    });

    it("é inofensivo quando a assinatura já está cancelada", async () => {
      const { service, asaas, clientSubscription } = build();
      clientSubscription.findUnique.mockResolvedValue({ id: "sub-1", status: "CANCELADA" });

      const result = await service.cancelCompanySubscription("empresa-1");

      expect(asaas.cancelSubscription).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "CANCELADA", alreadyCanceled: true });
    });
  });

  /**
   * A regra é uma cobrança só, com o valor total. Já emitimos cobrança avulsa de
   * consumo quando não havia mensalidade em aberto, e estava errado: o cliente
   * recebia duas cobranças no mês. Agora o consumo acumula até existir uma
   * mensalidade onde somar.
   */
  describe("sem mensalidade em aberto para somar", () => {
    function semCobrancaEmAberto() {
      return build({
        asaas: {
          listSubscriptionPayments: jest.fn().mockResolvedValue([
            { id: "pay_1", status: "CONFIRMED", value: 159.9, dueDate: "2026-08-13" },
          ]),
        },
        pending: [
          { id: "u1", companyId: "empresa-1", metric: "IA_TOKENS_SAIDA", quantity: 5000, billableAmount: 6 },
        ],
      });
    }

    it("não emite cobrança à parte para o consumo", async () => {
      const { service, asaas } = semCobrancaEmAberto();

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(asaas.createPayment).not.toHaveBeenCalled();
    });

    it("mantém o consumo pendente para entrar na próxima cobrança", async () => {
      // Acumular é o comportamento correto; marcar como sincronizado sem
      // cobrança faria o valor desaparecer.
      const { service, usageLedger } = semCobrancaEmAberto();

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(usageLedger.updateMany).not.toHaveBeenCalled();
    });
  });
});

/**
 * Consumo órfão: marcado como faturado numa cobrança que não existe mais.
 *
 * Aconteceu em produção. A cobrança foi apagada no painel, o webhook estava
 * desativado, o `PAYMENT_DELETED` não chegou — e R$ 6,00 de consumo ficaram
 * contados como cobrados sem cobrança nenhuma atrás. O painel mostrava um total
 * que a fatura não tinha.
 */
describe("consumo órfão de cobrança apagada", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function build(cobranca: any, options: { erro?: boolean } = {}) {
    const usageLedger = {
      findMany: jest.fn().mockResolvedValue([{ asaasPaymentId: "pay_apagada" }]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      findPayment: options.erro
        ? jest.fn().mockRejectedValue(new Error("Não foi possível alcançar a API do Asaas."))
        : jest.fn().mockResolvedValue(cobranca),
    };
    const service = buildBillingService({ prisma: { usageLedger }, asaas });
    service.onModuleDestroy();
    return { service, usageLedger, asaas };
  }

  it("devolve o consumo à fila quando a cobrança não existe mais", async () => {
    const { service, usageLedger } = build(null);

    await (service as never as Record<string, any>).reconcileOrphanUsage();

    expect(usageLedger.updateMany).toHaveBeenCalledWith({
      where: { asaasPaymentId: "pay_apagada", status: "SINCRONIZADO" },
      data: { status: "PENDENTE", asaasPaymentId: null },
    });
  });

  it("devolve também quando o Asaas marca a cobrança como apagada", async () => {
    const { service, usageLedger } = build({ id: "pay_apagada", deleted: true, status: "PENDING", value: 6 });

    await (service as never as Record<string, any>).reconcileOrphanUsage();

    expect(usageLedger.updateMany).toHaveBeenCalled();
  });

  it("não mexe em consumo cuja cobrança segue existindo", async () => {
    const { service, usageLedger } = build({ id: "pay_apagada", status: "PENDING", value: 6 });

    await (service as never as Record<string, any>).reconcileOrphanUsage();

    expect(usageLedger.updateMany).not.toHaveBeenCalled();
  });

  it("não devolve nada quando a consulta ao Asaas falha", async () => {
    // Tratar falha de rede como "cobrança inexistente" faria o consumo já
    // faturado ser cobrado de novo.
    const { service, usageLedger } = build(null, { erro: true });

    await (service as never as Record<string, any>).reconcileOrphanUsage();

    expect(usageLedger.updateMany).not.toHaveBeenCalled();
  });

  it("ignora lançamento recém-marcado, para não disputar com a rotina de consumo", async () => {
    const { service, usageLedger } = build(null);

    await (service as never as Record<string, any>).reconcileOrphanUsage();

    const filtro = usageLedger.findMany.mock.calls[0][0].where;
    expect(filtro.updatedAt.lt).toBeInstanceOf(Date);
    expect(Date.now() - filtro.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(9 * 60_000);
  });
});
