import { ConflictException } from "@nestjs/common";
import { buildPlatformWhatsAppService } from "./support/messaging-services";

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
    const gupshup = {
      isEnabled: jest.fn().mockReturnValue(true),
      mode: jest.fn().mockReturnValue("SELF_SERVE"),
      sendText: jest.fn().mockResolvedValue({ messageId: "gs-1", raw: {} }),
      ...((overrides.gupshup as Record<string, unknown>) ?? {}),
    };
    const secrets = {
      encrypt: jest.fn((value: string) => `cifrado:${value}`),
      decrypt: jest.fn(() => "token-decriptado"),
      ...((overrides.secrets as Record<string, unknown>) ?? {}),
    };
    const realtime = { emitToSuperAdmins: jest.fn() };
    const instance = buildPlatformWhatsAppService({
      prisma: prisma,
      gupshup: gupshup,
      secrets: secrets,
      aiProvider: { chat: jest.fn() },
      realtime: realtime,
    });
    return { instance, prisma, gupshup, secrets, realtime };
  }

  it("não permite vincular ao institucional um aplicativo de empresa cliente", async () => {
    // O nome do aplicativo é o que o callback usa para achar o canal: se os dois
    // apontassem para o mesmo, conversa de cliente cairia no inbox institucional.
    const { instance } = serviceWith({
      messagingChannel: { findUnique: jest.fn().mockResolvedValue({ id: "canal-cliente" }) },
    });

    await expect(
      instance.connectGupshupManual({ appName: "chegowiaempresa1" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("só ativa o canal quando o número é informado", async () => {
    const { instance } = serviceWith();

    const pendente = await instance.connectGupshupManual({ appName: "chegowiainstitucional" });
    expect(pendente).toEqual(expect.objectContaining({ connected: false }));

    const ativo = await instance.connectGupshupManual({
      appName: "chegowiainstitucional",
      appId: "app-1",
      number: "556231425344",
    });
    expect(ativo).toEqual(expect.objectContaining({ connected: true }));
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
