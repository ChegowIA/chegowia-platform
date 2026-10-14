import { buildBillingService } from "./support/messaging-services";
import { ResellersService } from "../src/resellers/resellers.service";

describe("segurança das rotas anônimas de cadastro", () => {
  describe("candidatura de empresa", () => {
    function build(existingPending: any) {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        company: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
        softwarePlan: { findFirst: jest.fn().mockResolvedValue({ id: "plano-1", monthlyPrice: 159.9, currency: "brl" }) },
        resellerProfile: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
        clientApplication: {
          findFirst: jest.fn().mockResolvedValue(existingPending),
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "nova", ...data })),
          update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: existingPending?.id, ...data })),
        },
      };
      const service = buildBillingService({ prisma: prisma });
      service.onModuleDestroy();
      // evaluateClient depende da IA; isolamos para o teste focar no armazenamento
      (service as any).evaluateClient = jest.fn().mockImplementation((application: any) => application);
      return { prisma, service };
    }

    const dto: any = {
      planId: "plano-1",
      responsibleName: "Atacante",
      email: "vitima@exemplo.com",
      phone: "11999999999",
      document: "11222333000181",
      companyName: "Empresa do Atacante",
      tradeName: "Atacante",
      city: "São Paulo",
      state: "sp",
      businessType: "Restaurante",
      operationDetails: "x".repeat(90),
      password: "SenhaDoAtacante@1",
    };

    it("não sobrescreve a candidatura pendente de outra pessoa com o mesmo e-mail", async () => {
      const vitima = { id: "app-da-vitima", email: "vitima@exemplo.com", stripeSessionId: "cs_vitima", passwordHash: "hash-da-vitima" };
      const { prisma, service } = build(vitima);

      await service.apply(dto);

      expect(prisma.clientApplication.update).not.toHaveBeenCalled();
      expect(prisma.clientApplication.create).toHaveBeenCalledTimes(1);
    });

    it("cria um registro novo em vez de reaproveitar o pendente", async () => {
      const { prisma, service } = build({ id: "app-da-vitima", email: "vitima@exemplo.com" });

      const application: any = await service.apply(dto);

      expect(application.id).toBe("nova");
      expect(prisma.clientApplication.create).toHaveBeenCalled();
    });

    it("recusa o domínio reservado da operação demo", async () => {
      const { prisma, service } = build(null);

      await expect(service.apply({ ...dto, email: "admin@demo.chegowia.invalid" })).rejects
        .toThrow("reservado à operação interna de demonstração");

      expect(prisma.clientApplication.create).not.toHaveBeenCalled();
    });

    it("força toda candidatura HTTP a nascer comercial, mesmo se o serviço receber campos forjados", async () => {
      const { prisma, service } = build(null);

      const application: any = await service.apply({
        ...dto,
        isTestOnly: true,
        monthlyPriceSnapshot: 0,
      });

      expect(application).toMatchObject({ isTestOnly: false, monthlyPriceSnapshot: 159.9 });
      expect(prisma.clientApplication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isTestOnly: false, monthlyPriceSnapshot: 159.9 }),
      });
    });
  });

  describe("lead de vendas", () => {
    it("não transmite e-mail nem telefone no broadcast para os revendedores", async () => {
      const lead = {
        id: "lead-1",
        name: "Fulano",
        email: "fulano@exemplo.com",
        phone: "11988887777",
        companyName: "Restaurante do Fulano",
        city: "São Paulo",
        state: "SP",
        message: "Quero conhecer",
        status: "DISPONIVEL",
        createdAt: new Date(),
      };
      const prisma = {
        salesLead: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(lead),
        },
      };
      const realtime = { emitToResellers: jest.fn() };
      // ordem do construtor: prisma, ai, realtime, storage, auth
      const service = new ResellersService(prisma as never, {} as never, realtime as never, {} as never, {} as never);

      await service.createLead({ name: "Fulano", email: "fulano@exemplo.com", phone: "11988887777", companyName: "Restaurante do Fulano", city: "São Paulo", state: "SP", message: "Quero conhecer" } as never);

      const [evento, payload] = realtime.emitToResellers.mock.calls[0];
      expect(evento).toBe("lead.available");
      expect(payload).not.toHaveProperty("email");
      expect(payload).not.toHaveProperty("phone");
      // o que a rede precisa para decidir se assume o lead continua disponível
      expect(payload).toMatchObject({ id: "lead-1", companyName: "Restaurante do Fulano", city: "São Paulo" });
    });
  });
});

describe("exposição de dados em rotas públicas de consulta", () => {
  it("mostra a tarifa final por métrica sem vazar custo interno ou margem", async () => {
    const prisma = {
      usageRate: {
        findMany: jest.fn().mockResolvedValue([
          {
            metric: "IA_TOKENS_ENTRADA",
            provider: "DeepSeek V4 Flash",
            label: "IA — entrada sem cache (1M tokens)",
            unitSize: 1_000_000,
            providerUnitCost: 0.710822,
            markupPercent: 200,
          },
          {
            metric: "WHATSAPP_TEMPLATE_UTILIDADE",
            provider: "Meta WhatsApp Brasil",
            label: "WhatsApp — template de utilidade",
            unitSize: 1,
            providerUnitCost: 0.035,
            markupPercent: 30,
          },
        ]),
      },
    };
    const service = buildBillingService({ prisma: prisma });
    service.onModuleDestroy();

    const result: any = await service.publicPricing();

    expect(result.billingCycle).toBe("mensal");
    expect(result.rates).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "IA_TOKENS_ENTRADA", pricePerUnit: 2.132466 }),
      expect.objectContaining({ metric: "WHATSAPP_TEMPLATE_UTILIDADE", pricePerUnit: 0.0455 }),
    ]));
    expect(JSON.stringify(result)).not.toContain("providerUnitCost");
    expect(JSON.stringify(result)).not.toContain("markupPercent");
  });

  it("validação de código devolve apenas o primeiro nome do revendedor", async () => {
    const prisma = {
      resellerProfile: {
        findFirst: jest.fn().mockResolvedValue({
          code: "MARIA1234",
          user: { name: "Maria Aparecida de Souza Lima" },
        }),
      },
    };
    const service = buildBillingService({ prisma: prisma });
    service.onModuleDestroy();

    const result: any = await service.validateCode("maria1234");

    expect(result.valid).toBe(true);
    expect(result.resellerName).toBe("Maria");
    expect(JSON.stringify(result)).not.toContain("Aparecida");
    expect(JSON.stringify(result)).not.toContain("Lima");
  });

  it("código inválido não vaza nada além do veredito", async () => {
    const prisma = { resellerProfile: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = buildBillingService({ prisma: prisma });
    service.onModuleDestroy();

    const result: any = await service.validateCode("INEXISTENTE1");

    expect(result).toEqual({ valid: false });
  });
});
