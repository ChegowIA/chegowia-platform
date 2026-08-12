import { MessagingChannelType, WhatsAppOrderDraftStatus } from "@prisma/client";
import { MessagingService } from "../src/messaging/messaging.service";

describe("Canal WhatsApp por empresa", () => {
  it("consulta o canal pelo tenant da sessão, nunca o primeiro canal da base", async () => {
    const prisma = {
      messagingChannel: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new MessagingService(
      prisma as never,
      {} as never,
      {} as never,
      { isConfigured: jest.fn().mockReturnValue(false) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.getWhatsappChannel("empresa-autenticada");

    expect(prisma.messagingChannel.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_type: {
          companyId: "empresa-autenticada",
          type: MessagingChannelType.WHATSAPP,
        },
      },
    });
  });

  it("limpa apenas mensagens e rascunho da conversa pertencente ao tenant autenticado", async () => {
    const transaction = {
      whatsAppMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      whatsAppOrderDraft: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      whatsAppConversation: { update: jest.fn().mockResolvedValue({ id: "conversa-da-empresa-a" }) },
    };
    const prisma = {
      whatsAppConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: "conversa-da-empresa-a", companyId: "empresa-a", orderDrafts: [] }),
      },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const realtime = { emitToCompany: jest.fn() };
    const service = new MessagingService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      realtime as never,
    );

    await expect(service.clearWhatsAppConversation("empresa-a", "conversa-da-empresa-a")).resolves.toEqual({
      id: "conversa-da-empresa-a",
      clearedMessages: 3,
    });

    expect(transaction.whatsAppMessage.deleteMany).toHaveBeenCalledWith({
      where: { companyId: "empresa-a", conversationId: "conversa-da-empresa-a" },
    });
    expect(transaction.whatsAppOrderDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: "empresa-a", conversationId: "conversa-da-empresa-a" }),
      data: expect.objectContaining({
        activeKey: null,
        status: WhatsAppOrderDraftStatus.CANCELADO,
      }),
    }));
    expect(transaction.whatsAppConversation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_companyId: { id: "conversa-da-empresa-a", companyId: "empresa-a" } },
      data: expect.objectContaining({ aiConversationId: null, lastMessageText: null }),
    }));
  });
});
