import { ConflictException } from "@nestjs/common";
import { PlatformWhatsAppService } from "../src/messaging/platform-whatsapp.service";

describe("Canal institucional do WhatsApp", () => {
  function serviceWith(prismaOverrides: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
    const prisma = {
      messagingChannel: { findUnique: jest.fn().mockResolvedValue(null) },
      platformWhatsAppChannel: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: "canal-plataforma", ...create })),
      },
      platformWhatsAppMessage: { findMany: jest.fn().mockResolvedValue([]) },
      platformUsageLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: "uso-plataforma", ...data })),
        update: jest.fn(),
      },
      usageRate: { findUnique: jest.fn().mockResolvedValue(null) },
      softwarePlan: {
        findFirst: jest.fn().mockResolvedValue({
          name: "ChegowIA Profissional",
          monthlyPrice: 159.9,
          features: ["Pedidos", "WhatsApp"],
        }),
      },
      ...prismaOverrides,
    };
    const meta = {
      getPhoneNumber: jest.fn().mockResolvedValue({
        id: "123456789012345",
        displayPhoneNumber: "+55 62 99999-9999",
        verifiedName: "ChegowIA",
        qualityRating: "GREEN",
      }),
      businessHasPhoneNumber: jest.fn().mockResolvedValue(true),
      subscribeAppToBusinessAccount: jest.fn().mockResolvedValue(undefined),
      ...((overrides.meta as Record<string, unknown>) ?? {}),
    };
    const secrets = {
      encrypt: jest.fn((value: string) => `cifrado:${value}`),
      decrypt: jest.fn(() => "token-decriptado"),
      ...((overrides.secrets as Record<string, unknown>) ?? {}),
    };
    const realtime = { emitToSuperAdmins: jest.fn() };
    const instance = new PlatformWhatsAppService(
      prisma as never,
      meta as never,
      {} as never,
      secrets as never,
      { chat: jest.fn() } as never,
      realtime as never,
    );
    return { instance, prisma, meta, secrets, realtime };
  }

  it("não permite usar no número institucional um Phone Number ID de empresa cliente", async () => {
    const { instance, meta } = serviceWith({
      messagingChannel: { findUnique: jest.fn().mockResolvedValue({ id: "canal-cliente" }) },
    });

    await expect(instance.connectCloud({
      phoneNumberId: "123456789012345",
      businessAccountId: "987654321098765",
      accessToken: "token-de-teste-comprido-o-suficiente",
    })).rejects.toBeInstanceOf(ConflictException);

    expect(meta.getPhoneNumber).not.toHaveBeenCalled();
  });

  it("cifra a credencial e nunca a devolve ao painel do superadmin", async () => {
    const { instance, secrets, meta } = serviceWith();

    const result = await instance.connectCloud({
      phoneNumberId: "123456789012345",
      businessAccountId: "987654321098765",
      accessToken: "token-secreto-da-meta-comprido-o-suficiente",
    });

    expect(secrets.encrypt).toHaveBeenCalledWith("token-secreto-da-meta-comprido-o-suficiente");
    expect(meta.subscribeAppToBusinessAccount).toHaveBeenCalledWith({
      businessAccountId: "987654321098765",
      accessToken: "token-secreto-da-meta-comprido-o-suficiente",
    });
    expect(result).toEqual(expect.objectContaining({ connected: true }));
    expect(JSON.stringify(result)).not.toContain("token-secreto-da-meta-comprido-o-suficiente");
  });

  it("usa o preço comercial público no contexto da IA", async () => {
    const { instance } = serviceWith();

    const messages = await (instance as any).messagesForAssistant("conversa-1", {
      welcomeMessage: null,
      salesInstructions: null,
    });

    expect(messages[0].content).toContain("R$ 159,90 por mês");
    expect(messages[0].content).toContain("https://chegowia.com.br/planos");
    expect(messages[0].content).toContain("nunca peça senha, código de verificação, token, cartão ou dado sensível");
  });

  it("contabiliza a IA comercial como custo da plataforma, sem companyId", async () => {
    const { instance, prisma } = serviceWith();

    await (instance as any).recordPlatformAiUsage("canal-plataforma", {
      requestId: "req-comercial-1",
      usage: { inputTokens: 100, cachedInputTokens: 20, uncachedInputTokens: 80, outputTokens: 30 },
    });

    expect(prisma.platformUsageLedger.create).toHaveBeenCalledTimes(3);
    expect(prisma.platformUsageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channelId: "canal-plataforma" }),
    }));
    expect(JSON.stringify(prisma.platformUsageLedger.create.mock.calls)).not.toContain("companyId");
  });
});
