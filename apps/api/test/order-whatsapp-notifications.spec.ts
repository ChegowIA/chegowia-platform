import { MessagingChannelStatus, OrderSource, OrderStatus } from "@prisma/client";
import { OrderWhatsAppNotificationsService, orderMessage } from "../src/orders/order-whatsapp-notifications.service";

describe("avisos de pedido pelo WhatsApp da loja", () => {
  const phone = "5562999999999";
  const notification = {
    id: "aviso-1", companyId: "loja-1", orderId: "pedido-123456",
    orderStatus: OrderStatus.CONFIRMADO, phone, state: "PENDING", attempts: 0,
  };

  function setup(source: OrderSource, options: { consent?: boolean; inbound?: Date; channelActive?: boolean; templatePending?: boolean } = {}) {
    const order = {
      id: notification.orderId, companyId: notification.companyId, customerPhone: phone,
      source, customerName: "Ana", customer: null, company: { name: "Pizzaria da Ana" },
      whatsappNotificationConsentAt: options.consent ? new Date() : null,
      whatsappConversation: options.inbound ? { id: "conversa-1", lastInboundAt: options.inbound } : null,
    };
    const db = {
      orderWhatsAppNotification: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([notification]),
        update: jest.fn().mockResolvedValue({}),
      },
      order: { findFirst: jest.fn().mockResolvedValue(order) },
      messagingChannel: { findUnique: jest.fn().mockResolvedValue({
        id: "canal-1", companyId: notification.companyId,
        status: options.channelActive === false ? "INATIVO" : MessagingChannelStatus.ATIVO,
        gupshupAppName: "loja-ana", gupshupAppId: "app-1", automationEnabled: true,
        config: {
          number: "556231425344",
          orderUpdateTemplateId: options.templatePending ? null : "modelo-1",
          orderUpdateTemplateState: options.templatePending ? "PENDING" : "APPROVED",
        },
      }) },
      whatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "conversa-1" }),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsAppMessage: { create: jest.fn().mockResolvedValue({}) },
    };
    const provider = {
      mode: jest.fn().mockReturnValue("SELF_SERVE"),
      isEnabled: jest.fn().mockReturnValue(true),
      sendTemplate: jest.fn().mockResolvedValue({ messageId: "mensagem-1", raw: {} }),
      sendText: jest.fn().mockResolvedValue({ messageId: "mensagem-1", raw: {} }),
    };
    const usage = { recordWhatsAppUsage: jest.fn().mockResolvedValue({ providerAmount: 0, billableAmount: 0 }) };
    const service = new OrderWhatsAppNotificationsService(db as never, provider as never, {} as never, usage as never);
    return { service, db, provider, usage };
  }

  it("envia pedido do site apenas com consentimento usando modelo da loja", async () => {
    const { service, db, provider } = setup(OrderSource.SITE, { consent: true });
    await service.processPending();
    expect(provider.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      appName: "loja-ana", to: phone, templateId: "modelo-1",
      variables: ["Ana", "123456", "Pizzaria da Ana", "confirmado"],
    }));
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(db.orderWhatsAppNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "SENT", providerMessageId: "mensagem-1" }),
    }));
  });

  it("não envia pedido do site sem consentimento", async () => {
    const { service, db, provider } = setup(OrderSource.SITE);
    await service.processPending();
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(db.orderWhatsAppNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "SKIPPED" }),
    }));
  });

  it("espera a aprovação sem consumir tentativas nem enviar o aviso", async () => {
    const { service, db, provider } = setup(OrderSource.SITE, { consent: true, templatePending: true });
    await service.processPending();
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(db.orderWhatsAppNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "RETRY", attempts: { decrement: 1 } }),
    }));
  });

  it("usa texto livre para pedido iniciado no WhatsApp dentro da janela de atendimento", async () => {
    const { service, provider } = setup(OrderSource.WHATSAPP, { inbound: new Date() });
    await service.processPending();
    expect(provider.sendText).toHaveBeenCalledWith(expect.objectContaining({
      appName: "loja-ana", to: phone, body: expect.stringContaining("confirmado"),
    }));
    expect(provider.sendTemplate).not.toHaveBeenCalled();
  });

  it("não manda texto livre fora da janela sem consentimento para modelo", async () => {
    const { service, db, provider } = setup(OrderSource.WHATSAPP, { inbound: new Date(Date.now() - 25 * 60 * 60_000) });
    await service.processPending();
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(db.orderWhatsAppNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "SKIPPED" }),
    }));
  });

  it("envia modelo fora da janela se o cliente autorizou avisos ao confirmar pelo WhatsApp", async () => {
    const { service, provider } = setup(OrderSource.WHATSAPP, {
      consent: true, inbound: new Date(Date.now() - 25 * 60 * 60_000),
    });
    await service.processPending();
    expect(provider.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: phone, templateId: "modelo-1",
    }));
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it("registra retry sem duplicar quando o provedor recusa antes de aceitar", async () => {
    const { service, db, provider } = setup(OrderSource.SITE, { consent: true });
    provider.sendTemplate.mockRejectedValueOnce(new Error("Gupshup indisponível"));
    await service.processPending();
    expect(db.whatsAppMessage.create).not.toHaveBeenCalled();
    expect(db.orderWhatsAppNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "RETRY", lastError: "Gupshup indisponível" }),
    }));
  });

  it("não reenvia automaticamente após falha de rede de resultado ambíguo", async () => {
    const { service, db, provider } = setup(OrderSource.SITE, { consent: true });
    provider.sendTemplate.mockRejectedValueOnce(new Error("Não foi possível alcançar a API do Gupshup."));
    await service.processPending();
    expect(db.orderWhatsAppNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "UNKNOWN" }),
    }));
  });

  it("mantém mensagem de status objetiva, sem preço nem dados sensíveis", () => {
    expect(orderMessage("Pizzaria da Ana", "123456", OrderStatus.SAIU_PARA_ENTREGA))
      .toContain("a caminho da entrega");
  });
});
