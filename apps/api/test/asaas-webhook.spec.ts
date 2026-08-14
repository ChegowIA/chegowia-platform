import { UnauthorizedException } from "@nestjs/common";
import { buildBillingService } from "./support/messaging-services";

/**
 * O webhook do Asaas não assina o corpo como o Stripe: a única prova de origem é
 * o token configurado ao criar o webhook, devolvido no header. Sem essa
 * verificação, qualquer um marcaria assinatura como paga.
 *
 * Os eventos também entram na mesma fila do Stripe, com o mesmo tratamento de
 * duplicata — o Asaas reenvia enquanto não receber 200, e processar duas vezes
 * ativaria a assinatura de novo e duplicaria comissão.
 */
describe("webhook do Asaas", () => {
  const ORIGINAL_ENV = { ...process.env };
  const TOKEN = "token-de-webhook-bem-comprido";

  beforeEach(() => {
    process.env.ASAAS_WEBHOOK_TOKEN = TOKEN;
    process.env.ASAAS_COMMISSION_POST_RECEIPT_HOLD_DAYS = "0";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const assinatura = {
    id: "sub-1",
    companyId: "empresa-1",
    resellerId: "rev-1",
    discountEndsAt: null,
    asaasSubscriptionId: "sub_asaas_1",
    plan: { monthlyPrice: 159.9 },
    reseller: { isActive: true, commissionRate: 0.3 },
  };

  function build(overrides: { assinatura?: any; asaas?: any; commissionLedger?: Record<string, unknown> } = {}) {
    const stripeEvent = {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    };
    const clientSubscription = {
      findUnique: jest.fn().mockResolvedValue("assinatura" in overrides ? overrides.assinatura : assinatura),
      update: jest.fn().mockResolvedValue({}),
    };
    const commissionLedger = {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
      ...(overrides.commissionLedger ?? {}),
    };
    const payoutBatch = {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    };
    // O consumo variável entra na mesma cobrança da mensalidade, então o
    // pagamento confirmado também o concilia.
    const usageLedger = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
    const prisma = {
      stripeEvent,
      clientSubscription,
      commissionLedger,
      payoutBatch,
      usageLedger,
      $transaction: jest.fn(async (operation: any) => (typeof operation === "function"
        ? operation({ payoutBatch, commissionLedger })
        : Promise.all(operation))),
    };
    const service = buildBillingService({ prisma, asaas: overrides.asaas ?? {} });
    service.onModuleDestroy();
    return { service, stripeEvent, clientSubscription, commissionLedger, payoutBatch, usageLedger, asaas: overrides.asaas };
  }

  const cobrancaPaga = {
    id: "evt_1",
    event: "PAYMENT_CONFIRMED",
    payment: { id: "pay_1", value: 159.9, subscription: "sub_asaas_1", customer: "cus_1" },
  };

  it("recusa requisição sem o token", async () => {
    const { service, stripeEvent } = build();

    await expect(service.handleAsaasWebhook(undefined, cobrancaPaga)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(stripeEvent.upsert).not.toHaveBeenCalled();
  });

  it("recusa token errado", async () => {
    const { service } = build();
    await expect(service.handleAsaasWebhook("token-errado", cobrancaPaga)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("enfileira o evento marcando a origem", async () => {
    const { service, stripeEvent } = build();

    await service.handleAsaasWebhook(TOKEN, cobrancaPaga);

    expect(stripeEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evt_1" },
        create: expect.objectContaining({ provider: "ASAAS", type: "PAYMENT_CONFIRMED" }),
        // O update vazio é o que torna o reenvio inofensivo.
        update: {},
      }),
    );
  });

  it("ativa a assinatura quando o pagamento é confirmado", async () => {
    const { service, clientSubscription } = build();

    await (service as never as Record<string, any>).applyAsaasEvent(cobrancaPaga);

    expect(clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ATIVA", asaasPaymentId: null }),
      }),
    );
  });

  it("não estende o ciclo de novo quando CONFIRMED e RECEIVED chegam para o mesmo pagamento", async () => {
    const { service, clientSubscription } = build({
      assinatura: {
        ...assinatura,
        status: "ATIVA",
        asaasPeriodPaymentId: "pay_1",
        currentPeriodStart: new Date("2026-08-13T12:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-13T12:00:00.000Z"),
      },
    });

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_RECEIVED",
    });

    expect(clientSubscription.update).not.toHaveBeenCalled();
  });

  it("registra a comissão em compensação quando o pagamento está apenas confirmado", async () => {
    const { service, commissionLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent(cobrancaPaga);

    const chamada = commissionLedger.upsert.mock.calls[0][0];
    expect(chamada.where).toEqual({ asaasPaymentId: "pay_1" });
    expect(chamada.create).toEqual(
      expect.objectContaining({
        grossAmount: 159.9,
        commissionAmount: 47.97,
        status: "PENDENTE",
        settledAt: null,
        availableAt: null,
        holdReason: "AGUARDANDO_COMPENSACAO_ASAAS",
      }),
    );
    // Reprocessar não pode duplicar lançamento.
    expect(chamada.update).toEqual({});
  });

  it("libera a comissão somente quando o Asaas confirma o crédito recebido", async () => {
    const { service, commissionLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_RECEIVED",
    });

    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "DISPONIVEL", settledAt: expect.any(Date) }),
      }),
    );
    expect(commissionLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ asaasPaymentId: "pay_1", status: "PENDENTE" }),
        data: expect.objectContaining({ status: "DISPONIVEL", settledAt: expect.any(Date) }),
      }),
    );
  });

  it("também libera a comissão quando o Asaas registra recebimento em espécie", async () => {
    const { service, commissionLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_RECEIVED_IN_CASH",
    });

    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "DISPONIVEL", settledAt: expect.any(Date) }),
      }),
    );
  });

  it("libera a comissão quando uma antecipação automática é efetivamente creditada", async () => {
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      findPayment: jest.fn().mockResolvedValue({
        ...cobrancaPaga.payment,
        status: "CONFIRMED",
      }),
    };
    const { service, commissionLedger } = build({ asaas });

    await (service as never as Record<string, any>).applyAsaasEvent({
      id: "evt_anticipacao_1",
      event: "RECEIVABLE_ANTICIPATION_CREDITED",
      anticipation: { payment: "pay_1", status: "CREDITED", netValue: 150 },
    });

    expect(asaas.findPayment).toHaveBeenCalledWith("pay_1");
    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "DISPONIVEL", settledAt: expect.any(Date) }),
      }),
    );
  });

  it("não antecipa comissão quando o Asaas ainda não creditou o recebível", async () => {
    const asaas = { isConfigured: jest.fn().mockReturnValue(true), findPayment: jest.fn() };
    const { service, commissionLedger } = build({ asaas });

    await (service as never as Record<string, any>).applyAsaasEvent({
      event: "RECEIVABLE_ANTICIPATION_PENDING",
      anticipation: { payment: "pay_1", status: "PENDING" },
    });

    expect(asaas.findPayment).not.toHaveBeenCalled();
    expect(commissionLedger.upsert).not.toHaveBeenCalled();
  });

  it("só baixa o saque quando chega TRANSFER_DONE", async () => {
    const { service, payoutBatch, commissionLedger } = build();
    payoutBatch.findUnique.mockResolvedValue({ id: "lote-1", status: "PROCESSANDO" });

    await (service as never as Record<string, any>).applyAsaasEvent({
      event: "TRANSFER_DONE",
      transfer: { id: "tra-1", status: "DONE" },
    });

    expect(payoutBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAGO", asaasTransferId: "tra-1" }) }),
    );
    expect(commissionLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAGA", asaasTransferId: "tra-1" }) }),
    );
  });

  it("recupera a comissão em compensação se o webhook PAYMENT_RECEIVED se perder", async () => {
    const entry = {
      asaasPaymentId: "pay_1",
      subscription: assinatura,
    };
    const { service, commissionLedger } = build({
      commissionLedger: {
        findMany: jest.fn().mockResolvedValue([{ asaasPaymentId: "pay_1" }]),
        findUnique: jest.fn().mockResolvedValue(entry),
      },
      asaas: {
        isConfigured: jest.fn().mockReturnValue(true),
        findPayment: jest.fn().mockResolvedValue({
          id: "pay_1",
          status: "RECEIVED",
          value: 159.9,
          subscription: "sub_asaas_1",
        }),
      },
    });

    await (service as never as Record<string, any>).reconcilePendingAsaasCommissions();

    expect(commissionLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DISPONIVEL" }) }),
    );
  });

  it("calcula os 30% só sobre a mensalidade, não sobre o consumo anexado à fatura", async () => {
    const { service, commissionLedger } = build({
      assinatura: { ...assinatura, plan: { monthlyPrice: 100 } },
    });

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      payment: { ...cobrancaPaga.payment, value: 145 },
    });

    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ grossAmount: 100, commissionAmount: 30 }),
      }),
    );
  });

  it("mantém os 30% do programa mesmo se houver taxa legada divergente no perfil", async () => {
    const { service, commissionLedger } = build({
      assinatura: { ...assinatura, reseller: { isActive: true, commissionRate: 0.5 }, plan: { monthlyPrice: 100 } },
    });

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      payment: { ...cobrancaPaga.payment, value: 100 },
    });

    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ commissionRate: 0.3, commissionAmount: 30 }) }),
    );
  });

  it("não gera comissão antes do fim real dos 7 dias de teste", async () => {
    const { service, commissionLedger } = build({
      assinatura: { ...assinatura, trialEndsAt: new Date(Date.now() + 60_000) },
    });

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_RECEIVED",
    });

    expect(commissionLedger.upsert).not.toHaveBeenCalled();
  });

  it("cria uma comissão por mensalidade recebida em cada renovação", async () => {
    const { service, commissionLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_RECEIVED",
      payment: { ...cobrancaPaga.payment, id: "pay_renovacao_2" },
    });

    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { asaasPaymentId: "pay_renovacao_2" } }),
    );
  });

  it("não comissiona outra cobrança do mesmo cliente que não pertença à assinatura", async () => {
    const { service, commissionLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      payment: { ...cobrancaPaga.payment, subscription: "sub_estranha" },
    });

    expect(commissionLedger.upsert).not.toHaveBeenCalled();
  });

  it("não cria comissão quando não há revendedor", async () => {
    const { service, commissionLedger } = build({
      assinatura: { ...assinatura, resellerId: null, reseller: null },
    });

    await (service as never as Record<string, any>).applyAsaasEvent(cobrancaPaga);

    expect(commissionLedger.upsert).not.toHaveBeenCalled();
  });

  it("estorna a comissão e marca inadimplência quando o pagamento volta", async () => {
    const { service, commissionLedger, clientSubscription } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_REFUNDED",
    });

    expect(commissionLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ESTORNADA" }) }),
    );
    expect(clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "INADIMPLENTE" } }),
    );
  });

  it("cria ajuste negativo idempotente se o estorno chegar depois de um saque", async () => {
    const { service, commissionLedger } = build();
    commissionLedger.updateMany.mockResolvedValueOnce({ count: 0 });
    commissionLedger.findUnique.mockResolvedValue({
      id: "com-1",
      resellerId: "rev-1",
      subscriptionId: "sub-1",
      grossAmount: 159.9,
      commissionRate: 0.3,
      commissionAmount: 47.97,
      currency: "brl",
      status: "PAGA",
    });

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_REFUNDED",
    });

    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalReference: "asaas-reversal:pay_1" },
        create: expect.objectContaining({ commissionAmount: -47.97, status: "DISPONIVEL" }),
      }),
    );
  });

  it("devolve ao razão o consumo já quitado quando há estorno ou chargeback", async () => {
    const { service, usageLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_REFUNDED",
    });

    expect(usageLedger.updateMany).toHaveBeenCalledWith({
      where: {
        asaasPaymentId: "pay_1",
        status: { in: ["SINCRONIZADO", "FATURADO"] },
      },
      data: { status: "PENDENTE", asaasPaymentId: null },
    });
  });

  it("reabre o consumo na mesma fatura quando dinheiro em espécie é desfeito", async () => {
    const { service, usageLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_RECEIVED_IN_CASH_UNDONE",
    });

    expect(usageLedger.updateMany).toHaveBeenCalledWith({
      where: { asaasPaymentId: "pay_1", status: "FATURADO" },
      data: { status: "SINCRONIZADO" },
    });
  });

  it("não bloqueia uma renovação mais nova por estorno de fatura antiga", async () => {
    const { service, clientSubscription } = build({
      assinatura: { ...assinatura, status: "ATIVA", asaasPeriodPaymentId: "pay_ciclo_novo" },
    });

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "PAYMENT_REFUNDED",
    });

    expect(clientSubscription.update).not.toHaveBeenCalled();
  });

  it("marca inadimplência no vencimento", async () => {
    const { service, clientSubscription } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({ ...cobrancaPaga, event: "PAYMENT_OVERDUE" });

    expect(clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "INADIMPLENTE" } }),
    );
  });

  it("cancela quando a assinatura é removida no Asaas", async () => {
    const { service, clientSubscription } = build();

    await (service as never as Record<string, any>).applyAsaasEvent({
      ...cobrancaPaga,
      event: "SUBSCRIPTION_DELETED",
    });

    expect(clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELADA" }) }),
    );
  });

  /**
   * Os nomes chegam como string e são comparados exatamente. Um nome inventado
   * produz um ramo que parece cobertura e nunca executa: foi o caso de
   * `PAYMENT_REVERSED`, que não existe no Asaas. O painel só oferece os nomes
   * abaixo, conferidos na conta real.
   */
  describe("nomes de evento aceitos", () => {
    const reverte = ["PAYMENT_REFUNDED", "PAYMENT_RECEIVED_IN_CASH_UNDONE"];

    it.each(reverte)("%s estorna a comissão e marca inadimplência", async (evento) => {
      const { service, commissionLedger, clientSubscription } = build();

      await (service as never as Record<string, any>).applyAsaasEvent({ ...cobrancaPaga, event: evento });

      expect(commissionLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "ESTORNADA" }) }),
      );
      expect(clientSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "INADIMPLENTE" } }),
      );
    });

    it("PAYMENT_CHARGEBACK_REQUESTED suspende o saque até a decisão final", async () => {
      const { service, commissionLedger, clientSubscription } = build();

      await (service as never as Record<string, any>).applyAsaasEvent({
        ...cobrancaPaga,
        event: "PAYMENT_CHARGEBACK_REQUESTED",
      });

      expect(commissionLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PENDENTE", holdReason: "CONTESTACAO_DE_PAGAMENTO" }),
        }),
      );
      expect(clientSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "INADIMPLENTE" } }),
      );
    });

    it("não trata PAYMENT_REVERSED, que não existe no Asaas", () => {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const fonte = readFileSync(join(__dirname, "..", "src", "billing", "billing.service.ts"), "utf8");
      // Só o comentário que explica a ausência pode citar o nome.
      expect(fonte).not.toMatch(/evento === "PAYMENT_REVERSED"/);
    });

    it("ignora evento desconhecido sem tocar em assinatura nem comissão", async () => {
      const { service, clientSubscription, commissionLedger } = build();

      await (service as never as Record<string, any>).applyAsaasEvent({
        ...cobrancaPaga,
        event: "PAYMENT_BANK_SLIP_VIEWED",
      });

      expect(clientSubscription.update).not.toHaveBeenCalled();
      expect(commissionLedger.upsert).not.toHaveBeenCalled();
    });

    it("devolve o consumo à fila quando a cobrança é apagada no painel", async () => {
      // Sem isso o lançamento ficaria SINCRONIZADO apontando para uma cobrança
      // que não existe: nunca mais cobrado e sem ninguém perceber.
      const { service, usageLedger } = build();

      await (service as never as Record<string, any>).applyAsaasEvent({
        ...cobrancaPaga,
        event: "PAYMENT_DELETED",
      });

      expect(usageLedger.updateMany).toHaveBeenCalledWith({
        where: { asaasPaymentId: "pay_1", status: "SINCRONIZADO" },
        data: { status: "PENDENTE", asaasPaymentId: null },
      });
    });

    it("não trata cobrança de consumo como mensalidade paga", async () => {
      // A cobrança avulsa de consumo repassa custo de IA e WhatsApp. Tratá-la
      // como assinatura paga renovaria o vínculo e pagaria 30% de comissão.
      const { service, clientSubscription, commissionLedger } = build();

      await (service as never as Record<string, any>).applyAsaasEvent({
        ...cobrancaPaga,
        payment: { ...cobrancaPaga.payment, externalReference: "usage-abc123", subscription: null },
      });

      expect(clientSubscription.update).not.toHaveBeenCalled();
      expect(commissionLedger.upsert).not.toHaveBeenCalled();
    });
  });
});
