import { MessagingChannelStatus } from "@prisma/client";
import { MessagingService } from "../src/messaging/messaging.service";

describe("destinatário brasileiro de número Meta de teste", () => {
  it("repete somente o erro #131030 com o nono dígito que o webhook pode omitir", async () => {
    const prisma = {
      whatsAppMessage: { create: jest.fn().mockResolvedValue({ id: "mensagem-1" }) },
      whatsAppConversation: { update: jest.fn().mockResolvedValue({ id: "conversa-1" }) },
      messagingChannel: { update: jest.fn().mockResolvedValue({ id: "canal-1" }) },
    };
    const meta = {
      sendText: jest
        .fn()
        .mockRejectedValueOnce(new Error("A Meta recusou a operação: (#131030) Recipient phone number not in allowed list"))
        .mockResolvedValueOnce({ messageId: "wamid-teste", raw: { messages: [{ id: "wamid-teste" }] } }),
    };
    const usage = { recordWhatsAppUsage: jest.fn().mockResolvedValue({ providerAmount: 0, billableAmount: 0 }) };
    const realtime = { emitToCompany: jest.fn() };
    const service = new MessagingService(
      prisma as never,
      {} as never,
      meta as never,
      { decrypt: jest.fn().mockReturnValue("token-teste") } as never,
      {} as never,
      usage as never,
      realtime as never,
    );

    await (service as any).sendText(
      { id: "conversa-1", companyId: "empresa-1", channelId: "canal-1", customerPhone: "556286251491" },
      {
        id: "canal-1",
        status: MessagingChannelStatus.ATIVO,
        metaPhoneNumberId: "1272068155983625",
        metaAccessTokenEncrypted: "cifrado",
      },
      "Teste de retorno",
      "usuario-1",
    );

    expect(meta.sendText).toHaveBeenNthCalledWith(1, expect.objectContaining({ to: "556286251491" }));
    expect(meta.sendText).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: "5562986251491" }));
    expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ENVIADA", body: "Teste de retorno" }),
    }));
  });
});
