import { ApplicationStatus, SubscriptionStatus } from "@prisma/client";
import { BillingService } from "../src/billing/billing.service";

describe("teste gratuito de empresas", () => {
  it("cria empresa e assinatura EM_TESTE por sete dias sem checkout antecipado", async () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);
    const transaction = {
      company: { create: jest.fn().mockResolvedValue({ id: "empresa-1" }) },
      identityDocument: { create: jest.fn().mockResolvedValue({}) },
      user: { create: jest.fn().mockResolvedValue({ id: "admin-1" }) },
      clientSubscription: { create: jest.fn().mockResolvedValue({}) },
      clientApplication: { update: jest.fn().mockResolvedValue({}) },
      salesLead: { updateMany: jest.fn().mockResolvedValue({}) },
    };
    const application = {
      id: "app-1",
      status: ApplicationStatus.APROVADA,
      companyId: null,
      planId: "plano-1",
      resellerId: null,
      resellerCode: null,
      sourceLeadId: null,
      responsibleName: "Ana Empresária",
      email: "ana@empresa.com",
      phone: "11999999999",
      document: "11222333000181",
      companyName: "Empresa da Ana LTDA",
      tradeName: "Empresa da Ana",
      city: "São Paulo",
      state: "SP",
      passwordHash: "hash",
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      plan: { slug: "profissional", monthlyPrice: 159.9 },
    };
    const prisma = {
      clientApplication: { findUnique: jest.fn().mockResolvedValue(application) },
      clientSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (tx: typeof transaction) => unknown) => work(transaction)),
    };
    const auth = { sendVerificationForUser: jest.fn().mockResolvedValue(undefined) };
    const service = new BillingService(prisma as never, {} as never, auth as never, {} as never, {} as never);
    service.onModuleDestroy();

    const result = await service.startTrial("app-1");

    expect(result).toMatchObject({ trialStarted: true, companyId: "empresa-1", trialDays: 7 });
    expect(new Date(result.trialEndsAt).getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(transaction.clientSubscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId: "empresa-1",
        status: SubscriptionStatus.EM_TESTE,
        trialStartedAt: now,
        trialEndsAt: result.trialEndsAt,
        monthlyPriceSnapshot: 159.9,
      }),
    }));
    expect(auth.sendVerificationForUser).toHaveBeenCalledWith("admin-1");
    jest.useRealTimers();
  });

  it("pausa acesso ao vencer o teste mesmo se a flag de cobrança estiver desligada", async () => {
    const previousEnforcement = process.env.BILLING_ENFORCEMENT;
    process.env.BILLING_ENFORCEMENT = "false";
    const usage = { getBillingUsage: jest.fn().mockResolvedValue({ estimatedTotal: 0 }) };
    const prisma = {
      clientSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          status: SubscriptionStatus.EM_TESTE,
          trialStartedAt: new Date("2026-07-20T12:00:00.000Z"),
          trialEndsAt: new Date("2026-07-27T12:00:00.000Z"),
          plan: { name: "Profissional", monthlyPrice: 159.9, currency: "brl" },
          reseller: null,
        }),
      },
    };
    const service = new BillingService(prisma as never, {} as never, {} as never, usage as never, {} as never);
    service.onModuleDestroy();

    const status = await service.companyBillingStatus("empresa-1");

    expect(status.accessRestricted).toBe(true);
    expect(status.activationAvailable).toBe(true);
    expect(status.trial).toMatchObject({ expired: true, current: true, days: 7 });
    expect(usage.getBillingUsage).toHaveBeenCalledWith("empresa-1", 0);
    process.env.BILLING_ENFORCEMENT = previousEnforcement;
  });

  it("expõe R$ 0,50 para novas contratações somente durante o modo temporário", async () => {
    const prisma = {
      softwarePlan: {
        findMany: jest.fn().mockResolvedValue([
          { id: "plano-1", monthlyPrice: 159.9, isFeatured: true },
        ]),
      },
    };
    const temporaryMode = { monthlyPriceOverride: jest.fn().mockReturnValue(0.5) };
    const service = new BillingService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      temporaryMode as never,
    );
    service.onModuleDestroy();

    await expect(service.listPlans()).resolves.toEqual([
      expect.objectContaining({ id: "plano-1", monthlyPrice: 0.5 }),
    ]);
  });
});
