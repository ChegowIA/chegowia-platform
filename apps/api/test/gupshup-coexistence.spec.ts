import { buildMessagingService } from "./support/messaging-services";

/**
 * A coexistência não usa o evento normal `messages` para o que foi digitado no
 * celular da empresa. Estes testes evitam uma regressão silenciosa em que o
 * cliente vê a resposta no app, mas a Central nunca fica sabendo dela.
 */
describe("coexistência do WhatsApp Business App pelo Gupshup", () => {
  const channel = {
    id: "canal-1",
    companyId: "empresa-1",
    status: "ATIVO",
    provider: "GUPSHUP",
    gupshupAppId: "app-1",
    config: { gupshupConnectionMode: "COEXISTENCE" },
  };

  it("reconhece o evento smb_message_echoes no webhook Meta v3", async () => {
    const prisma = {
      messagingChannel: { findUnique: jest.fn().mockResolvedValue(channel) },
    };
    const service = buildMessagingService({ prisma });
    const processEchoes = jest.spyOn(service as any, "processCoexistenceEchoesForChannel").mockResolvedValue(undefined);

    await service.handleGupshupWebhook({
      object: "whatsapp_business_account",
      gs_app_id: "app-1",
      entry: [{ changes: [{
        field: "smb_message_echoes",
        value: { message_echoes: [{ id: "wamid-1", to: "5562988887777" }] },
      }] }],
    });

    expect(processEchoes).toHaveBeenCalledWith(
      channel,
      expect.objectContaining({ message_echoes: expect.any(Array) }),
      "app-1",
    );
  });

  it("registra uma mensagem enviada pelo app como saída humana, sem invocar a IA", async () => {
    const prisma = {
      messagingChannel: { update: jest.fn().mockResolvedValue(channel) },
      whatsAppMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "mensagem-1" }),
      },
      whatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "conversa-1", companyId: "empresa-1" }),
      },
    };
    const realtime = { emitToCompany: jest.fn() };
    const service = buildMessagingService({ prisma, realtime });

    await (service as any).processCoexistenceEchoesForChannel(channel, {
      message_echoes: [{
        id: "wamid-enviado-pelo-celular",
        from: "5562999900000",
        to: "5562988887777",
        type: "text",
        text: { body: "Seu pedido já saiu para entrega." },
      }],
    }, "app-1");

    expect(prisma.whatsAppConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        customerPhone: "5562988887777",
        mode: "HUMANO",
      }),
    }));
    expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerMessageId: "wamid-enviado-pelo-celular",
        direction: "ENVIADA",
        status: "ENVIADA",
        body: "Seu pedido já saiu para entrega.",
      }),
    }));
    expect(realtime.emitToCompany).toHaveBeenCalledWith(
      "empresa-1",
      "whatsapp.message.sent",
      { conversationId: "conversa-1" },
    );
  });

  it("desativa o canal quando o aplicativo remove a parceria", async () => {
    const prisma = { messagingChannel: { update: jest.fn().mockResolvedValue(channel) } };
    const realtime = { emitToCompany: jest.fn() };
    const service = buildMessagingService({ prisma, realtime });

    await (service as any).processGupshupAccountUpdate(channel, {
      event: "PARTNER_REMOVED",
      disconnection_info: { reason: "USER_RE_REGISTERED" },
    }, "app-1");

    expect(prisma.messagingChannel.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "INATIVO",
        lastError: expect.stringContaining("outro aparelho"),
      }),
    }));
    expect(realtime.emitToCompany).toHaveBeenCalledWith(
      "empresa-1",
      "whatsapp.channel.updated",
      expect.objectContaining({ status: "INATIVO" }),
    );
  });
});
