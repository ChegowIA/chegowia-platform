import { MessagingService } from "../src/messaging/messaging.service";

describe("Meta Embedded Signup", () => {
  const savedEnvironment = {
    WHATSAPP_CLOUD_API_ENABLED: process.env.WHATSAPP_CLOUD_API_ENABLED,
    META_EMBEDDED_SIGNUP_ENABLED: process.env.META_EMBEDDED_SIGNUP_ENABLED,
    META_APP_ID: process.env.META_APP_ID,
    META_EMBEDDED_SIGNUP_CONFIG_ID: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
  };

  beforeEach(() => {
    process.env.WHATSAPP_CLOUD_API_ENABLED = "true";
    process.env.META_EMBEDDED_SIGNUP_ENABLED = "true";
    process.env.META_APP_ID = "123456789012345";
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "987654321098765";
    process.env.META_APP_SECRET = "segredo-da-meta-para-teste";
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("troca o código somente no servidor e devolve ao painel apenas o resumo do canal", async () => {
    const prisma = {
      messagingChannel: {
        // Primeiro: consulta global para colisão. Segundo: canal atual da empresa.
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: "canal-1", ...create })),
      },
      company: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const meta = {
      exchangeEmbeddedSignupCode: jest.fn().mockResolvedValue({ accessToken: "token-privado", expiresInSeconds: 3600 }),
      businessHasPhoneNumber: jest.fn().mockResolvedValue(true),
      getPhoneNumber: jest.fn().mockResolvedValue({
        id: "123456789012345",
        displayPhoneNumber: "+55 62 99999-9999",
        verifiedName: "Empresa teste",
        qualityRating: "GREEN",
      }),
      registerPhoneNumber: jest.fn().mockResolvedValue(undefined),
      subscribeAppToBusinessAccount: jest.fn().mockResolvedValue(undefined),
    };
    const secrets = {
      encrypt: jest.fn((value: string) => `cifrado:${value}`),
      isConfigured: jest.fn().mockReturnValue(true),
    };
    const service = new MessagingService(
      prisma as never,
      {} as never,
      meta as never,
      secrets as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.completeWhatsAppEmbeddedSignup("empresa-1", {
      code: "codigo-de-uso-unico-da-meta",
      phoneNumberId: "123456789012345",
      businessAccountId: "987654321098765",
      businessPortfolioId: "456789123456789",
      event: "FINISH",
    });

    expect(meta.exchangeEmbeddedSignupCode).toHaveBeenCalledWith(expect.objectContaining({
      appId: "123456789012345",
      code: "codigo-de-uso-unico-da-meta",
    }));
    expect(meta.businessHasPhoneNumber).toHaveBeenCalledWith({
      businessAccountId: "987654321098765",
      phoneNumberId: "123456789012345",
      accessToken: "token-privado",
    });
    expect(meta.registerPhoneNumber).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumberId: "123456789012345",
      accessToken: "token-privado",
      pin: expect.stringMatching(/^\d{6}$/),
    }));
    expect(meta.subscribeAppToBusinessAccount).toHaveBeenCalledWith({
      businessAccountId: "987654321098765",
      accessToken: "token-privado",
    });
    expect(secrets.encrypt).toHaveBeenCalledWith("token-privado");
    expect(result).toEqual(expect.objectContaining({
      connected: true,
      integration: expect.objectContaining({
        phoneNumberId: "123456789012345",
        businessAccountId: "987654321098765",
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("token-privado");
  });

  it("não tenta registrar novamente um número do WhatsApp Business App em coexistência", async () => {
    const prisma = {
      messagingChannel: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: "canal-coexistencia", ...create })),
      },
      company: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const meta = {
      exchangeEmbeddedSignupCode: jest.fn().mockResolvedValue({ accessToken: "token-privado", expiresInSeconds: 3600 }),
      businessHasPhoneNumber: jest.fn().mockResolvedValue(true),
      getPhoneNumber: jest.fn().mockResolvedValue({
        id: "123456789012345",
        displayPhoneNumber: "+55 62 99999-9999",
        verifiedName: "Empresa teste",
        qualityRating: "GREEN",
      }),
      registerPhoneNumber: jest.fn().mockResolvedValue(undefined),
      subscribeAppToBusinessAccount: jest.fn().mockResolvedValue(undefined),
    };
    const secrets = {
      encrypt: jest.fn((value: string) => `cifrado:${value}`),
      isConfigured: jest.fn().mockReturnValue(true),
    };
    const service = new MessagingService(
      prisma as never,
      {} as never,
      meta as never,
      secrets as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.completeWhatsAppEmbeddedSignup("empresa-1", {
      code: "codigo-de-uso-unico-da-meta",
      phoneNumberId: "123456789012345",
      businessAccountId: "987654321098765",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    });

    expect(meta.registerPhoneNumber).not.toHaveBeenCalled();
    expect(meta.subscribeAppToBusinessAccount).toHaveBeenCalledTimes(1);
  });
});
