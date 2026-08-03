import { MessagingChannelType } from "@prisma/client";
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
});
