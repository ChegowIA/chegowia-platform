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
   * Assinatura no cartão não deixa mensalidade em aberto: o Asaas gera e captura
   * a cobrança no vencimento. Sem cobrança para alterar, o consumo precisa sair
   * em fatura própria — descobrimos isso quando o Asaas recusou antecipar o
   * vencimento de uma assinatura de cartão já paga.
   */
  describe("sem mensalidade em aberto para somar", () => {
    function semCobrancaEmAberto(extra: Record<string, any> = {}) {
      return build({
        asaas: {
          listSubscriptionPayments: jest.fn().mockResolvedValue([
            { id: "pay_1", status: "CONFIRMED", value: 159.9, dueDate: "2026-08-13" },
          ]),
          ...extra,
        },
        pending: [
          { id: "u1", companyId: "empresa-1", metric: "IA_TOKENS_SAIDA", quantity: 5000, billableAmount: 6 },
        ],
      });
    }

    it("cria cobrança própria para o consumo", async () => {
      const { service, asaas, usageLedger } = semCobrancaEmAberto();

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(asaas.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_1",
          value: 6,
          externalReference: expect.stringMatching(/^usage-/),
        }),
      );
      expect(usageLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "SINCRONIZADO", asaasPaymentId: "pay_uso" } }),
      );
    });

    it("não cria segunda cobrança quando a referência já existe", async () => {
      // Sem chave de idempotência no Asaas, é a referência que impede cobrar o
      // mesmo consumo duas vezes depois de uma resposta perdida.
      const { service, asaas } = semCobrancaEmAberto({
        findPaymentByReference: jest.fn().mockResolvedValue({ id: "pay_antiga", status: "PENDING", value: 6 }),
      });

      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(asaas.createPayment).not.toHaveBeenCalled();
    });

    it("acumula consumo abaixo do mínimo em vez de emitir cobrança de centavos", async () => {
      const { service, asaas, usageLedger } = build({
        asaas: {
          listSubscriptionPayments: jest.fn().mockResolvedValue([
            { id: "pay_1", status: "CONFIRMED", value: 159.9, dueDate: "2026-08-13" },
          ]),
        },
      });

      // Os lançamentos padrão somam R$ 1,50, abaixo do mínimo de R$ 5,00.
      await (service as never as Record<string, any>).syncVariableUsageToAsaas();

      expect(asaas.createPayment).not.toHaveBeenCalled();
      // Continua pendente: o consumo não pode desaparecer por ser pequeno.
      expect(usageLedger.updateMany).not.toHaveBeenCalled();
    });
  });
});
