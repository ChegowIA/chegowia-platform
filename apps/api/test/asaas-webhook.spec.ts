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
    process.env.COMMISSION_HOLD_DAYS = "7";
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
    reseller: { isActive: true, commissionRate: 0.3 },
  };

  function build(overrides: { assinatura?: any } = {}) {
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
    const commissionLedger = { upsert: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const prisma = { stripeEvent, clientSubscription, commissionLedger };
    const service = buildBillingService({ prisma });
    service.onModuleDestroy();
    return { service, stripeEvent, clientSubscription, commissionLedger };
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

  it("registra a comissão pendente, respeitando a carência", async () => {
    const { service, commissionLedger } = build();

    await (service as never as Record<string, any>).applyAsaasEvent(cobrancaPaga);

    const chamada = commissionLedger.upsert.mock.calls[0][0];
    expect(chamada.where).toEqual({ asaasPaymentId: "pay_1" });
    expect(chamada.create).toEqual(
      expect.objectContaining({ commissionAmount: 47.97, status: "PENDENTE" }),
    );
    // Reprocessar não pode duplicar lançamento.
    expect(chamada.update).toEqual({});
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
      expect.objectContaining({ data: { status: "ESTORNADA" } }),
    );
    expect(clientSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "INADIMPLENTE" } }),
    );
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
});
