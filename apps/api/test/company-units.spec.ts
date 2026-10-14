import { Role, SubscriptionStatus } from "@prisma/client";
import { CompaniesService } from "../src/companies/companies.service";
import { AuthService } from "../src/auth/auth.service";
import { AccountStatusGuard } from "../src/common/guards/account-status.guard";
import * as bcrypt from "bcrypt";

const owner = { id: "owner-1", name: "Ana", email: "ana@pizzaria.com.br", role: Role.ADMIN,
  companyId: "matriz-1", isActive: true };
const identity = { sub: owner.id, role: Role.ADMIN, companyId: "matriz-1",
  mfaSessionStartedAt: Date.now() - 1000, mfaSessionExpiresAt: Date.now() + 60_000 } as never;

describe("unidades independentes", () => {
  it("cria outra Company com assinatura própria sem copiar dados operacionais", async () => {
    const source = {
      id: "matriz-1", deliveryFeeBase: 6, deliveryFeePerKm: 2,
      ownerUserId: owner.id,
      deliveryRadiusKm: 15, avgDeliveryTimeMinutes: 40, logoUrl: "/logo.webp",
      settings: { openingHours: { segunda: [] }, paymentMethodsEnabled: ["PIX"], pickupEnabled: true },
      subscription: { plan: { id: "plano-1", slug: "profissional", monthlyPrice: 159.9 } },
    };
    const tx = {
      company: { create: jest.fn().mockResolvedValue({ id: "filial-1", name: "Pizzaria Sul", slug: "pizzaria-sul", zipCode: "74900000", city: "Aparecida de Goiânia", state: "GO" }) },
      identityDocument: { create: jest.fn().mockResolvedValue({}) },
      clientSubscription: { create: jest.fn().mockResolvedValue({}) },
      user: { create: jest.fn().mockResolvedValue({ id: "local-admin-1", email: "local@pizzaria.com.br" }) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id ? owner : null)) },
      company: { findFirst: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id ? source : null)), findUnique: jest.fn().mockResolvedValue(null) },
      identityDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (db: typeof tx) => unknown) => fn(tx)),
    };
    const service = new CompaniesService(prisma as never, { inviteUnitAdmin: jest.fn().mockResolvedValue(true) } as never, {} as never,
      { warm: jest.fn() } as never);
    const result = await service.createUnit(identity, {
      name: "Pizzaria Sul", cnpj: "11222333000181", phone: "62999999999",
      addressLine: "Rua Sul, 10", city: "Aparecida de Goiânia", state: "GO", zipCode: "74900000",
      adminName: "Caio Local", adminEmail: "local@pizzaria.com.br",
    });

    expect(result.id).toBe("filial-1");
    expect(tx.company.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: owner.id, cnpj: "11222333000181", locationConfirmedAt: null, isPublished: false,
      settings: { create: expect.objectContaining({ plan: "profissional" }) },
    }) });
    expect(tx.clientSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      companyId: "filial-1", planId: "plano-1", monthlyPriceSnapshot: 159.9,
      status: SubscriptionStatus.EM_TESTE,
    }) });
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "local@pizzaria.com.br", companyId: "filial-1", role: Role.ADMIN }),
    }));
    expect(Object.keys(tx).sort()).toEqual(["clientSubscription", "company", "identityDocument", "user"]);
  });

  it("aceita o mesmo CNPJ só quando pertence ao titular e é o mesmo estabelecimento físico", async () => {
    const registration = { id: "matriz-1", ownerUserId: owner.id, cnpj: "11222333000181",
      zipCode: "74900000", addressLine: "Rua Sul, 10", city: "Aparecida de Goiânia", state: "GO" };
    const source = { ...registration, subscription: { plan: { id: "plano-1", slug: "profissional", monthlyPrice: 159.9 } } };
    const tx = { company: { create: jest.fn().mockResolvedValue({ id: "filial-1", name: "Outra marca" }) },
      identityDocument: { create: jest.fn() }, clientSubscription: { create: jest.fn() },
      user: { create: jest.fn().mockResolvedValue({ id: "admin-local", email: "local@pizzaria.com.br" }) } };
    const prisma = {
      user: { findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(where.id ? owner : null)) },
      identityDocument: { findUnique: jest.fn().mockResolvedValue({ ownerType: "COMPANY", ownerId: "matriz-1" }) },
      company: { findFirst: jest.fn().mockImplementation(({ where }: { where: { cnpj?: string } }) => Promise.resolve(where.cnpj ? registration : source)),
        findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (db: typeof tx) => unknown) => fn(tx)),
    };
    const service = new CompaniesService(prisma as never, { inviteUnitAdmin: jest.fn().mockResolvedValue(true) } as never,
      {} as never, { warm: jest.fn() } as never);
    const form = { name: "Outra marca", cnpj: "11222333000181", shareCnpj: true,
      phone: "62999999999", addressLine: "Rua Sul, 10", city: "Aparecida de Goiânia", state: "GO",
      zipCode: "74900000", adminName: "Caio", adminEmail: "local@pizzaria.com.br" };
    await expect(service.createUnit(identity, form)).resolves.toMatchObject({ id: "filial-1" });
    expect(tx.identityDocument.create).not.toHaveBeenCalled();
    await expect(service.createUnit(identity, { ...form, addressLine: "Outra Rua, 10" })).rejects.toThrow("mesmo endereço físico");
    await expect(service.createUnit(identity, { ...form, shareCnpj: false })).rejects.toThrow("mesmo endereço físico");
    const outsider = new CompaniesService({ ...prisma,
      company: { ...prisma.company, findFirst: jest.fn().mockImplementation(({ where }: { where: { cnpj?: string } }) =>
        Promise.resolve(where.cnpj ? { ...registration, id: "empresa-alheia", ownerUserId: "outro-titular" } : source)) } } as never,
      {} as never, {} as never, {} as never);
    await expect(outsider.createUnit(identity, form)).rejects.toThrow("mesmo endereço físico");
  });

  it("a unidade demo herda o isolamento e não gera assinatura faturável", async () => {
    const source = { id: "demo-root", ownerUserId: owner.id, slug: "operacao-demo-chegowia", isTestOnly: true,
      subscription: { plan: { id: "plano-1", slug: "profissional", monthlyPrice: 159.9 } } };
    const tx = { company: { create: jest.fn().mockResolvedValue({ id: "demo-child", name: "Demo Sul" }) },
      identityDocument: { create: jest.fn() }, clientSubscription: { create: jest.fn() },
      user: { create: jest.fn().mockResolvedValue({ id: "admin-demo", email: "local@example.com" }) } };
    const prisma = { user: { findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where.id ? owner : null)) }, company: { findFirst: jest.fn().mockResolvedValue(source), findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (db: typeof tx) => unknown) => fn(tx)) };
    const service = new CompaniesService(prisma as never, { inviteUnitAdmin: jest.fn().mockResolvedValue(true) } as never,
      {} as never, { warm: jest.fn() } as never);
    await service.createUnit(identity, { name: "Demo Sul", phone: "62999999999", addressLine: "Rua Sul, 10",
      city: "Goiânia", state: "GO", zipCode: "74013010", adminName: "Local", adminEmail: "local@example.com" });
    expect(tx.company.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      isTestOnly: true, demoRootCompanyId: "demo-root", isPublished: false, cnpj: null,
    }) });
    expect(tx.clientSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: SubscriptionStatus.ATIVA, monthlyPriceSnapshot: 0, trialEndsAt: null,
    }) });
  });

  it("não permite ao administrador entrar em unidade sem vínculo", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(owner) },
      company: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new AuthService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.switchOwnedCompany(identity, "empresa-alheia"))
      .rejects.toThrow("Unidade não encontrada");
    expect(prisma.company.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "empresa-alheia", OR: [{ id: "matriz-1" }, { ownerUserId: "owner-1" }] },
    }));
  });

  it("não deixa o administrador local criar filiais em nome do titular", async () => {
    const local = { ...owner, id: "admin-local", companyId: "filial-1" };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(local) },
      company: { findFirst: jest.fn().mockResolvedValue({ id: "filial-1", ownerUserId: owner.id,
        subscription: { plan: { id: "plano-1" } } }) },
    };
    const service = new CompaniesService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.createUnit({ ...local, sub: local.id, role: Role.ADMIN } as never,
      { name: "Filial indevida" } as never)).rejects.toThrow("administrador desta unidade não pode criar");
  });

  it("troca o tenant da sessão preservando a janela MFA e grava a unidade no refresh", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(owner) },
      company: { findFirst: jest.fn().mockResolvedValue({ id: "filial-1", isActive: true }) },
      refreshToken: { create: jest.fn().mockResolvedValue({ id: "refresh-1" }) },
    };
    const jwt = { sign: jest.fn().mockReturnValue("jwt-unidade") };
    const service = new AuthService(prisma as never, jwt as never, {} as never, {} as never);
    const result = await service.switchOwnedCompany(identity, "filial-1");
    expect(result.user.companyId).toBe("filial-1");
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({
      sub: owner.id, role: Role.ADMIN, companyId: "filial-1",
      mfaSessionExpiresAt: expect.any(Number),
    }), expect.anything());
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: owner.id, activeCompanyId: "filial-1",
    }) });
  });

  it("o administrador local entra com e-mail/senha próprios, precisa de MFA e não acessa outras unidades", async () => {
    const local = { id: "admin-local", name: "Caio", email: "local@pizzaria.com.br", role: Role.ADMIN,
      companyId: "filial-1", isActive: true, emailVerifiedAt: new Date(),
      passwordHash: await bcrypt.hash("SenhaForte@2026", 10) };
    const mail = { sendMfaCode: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(local) },
      company: { findUnique: jest.fn().mockResolvedValue({ isActive: true }), findFirst: jest.fn().mockResolvedValue(null) },
      accountToken: { updateMany: jest.fn(), update: jest.fn(), create: jest.fn().mockResolvedValue({ id: "desafio-1" }),
        findFirst: jest.fn() },
      refreshToken: { create: jest.fn().mockResolvedValue({ id: "refresh-1" }) },
    };
    const jwt = { sign: jest.fn().mockReturnValue("jwt-local") };
    const auth = new AuthService(prisma as never, jwt as never, mail as never, {} as never);
    const challenge = await auth.login({ email: local.email, password: "SenhaForte@2026" });
    expect(challenge).toMatchObject({ mfaRequired: true, challengeId: "desafio-1" });
    expect(mail.sendMfaCode).toHaveBeenCalledWith(local.email, local.name, expect.any(String));
    const code = mail.sendMfaCode.mock.calls[0][2];
    prisma.accountToken.findFirst.mockResolvedValue({ id: "desafio-1", user: local,
      tokenHash: await bcrypt.hash(code, 10) });
    const session = await auth.verifyMfa("desafio-1", code);
    expect(session.user).toMatchObject({ id: local.id, role: Role.ADMIN, companyId: "filial-1" });
    await expect(auth.switchOwnedCompany({ sub: local.id, role: Role.ADMIN, companyId: "filial-1",
      mfaSessionStartedAt: Date.now() - 1000, mfaSessionExpiresAt: Date.now() + 60_000 } as never, "matriz-1"))
      .rejects.toThrow("Unidade não encontrada");
  });

  it("não publica unidade sem ponto confirmado no mapa", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(owner) },
      company: {
        findFirst: jest.fn().mockResolvedValue({ id: "filial-1", isActive: true,
          locationConfirmedAt: null, latitude: null, longitude: null,
          subscription: { status: SubscriptionStatus.EM_TESTE, trialEndsAt: new Date(Date.now() + 60_000) } }),
        update: jest.fn(),
      },
      product: { findFirst: jest.fn() },
    };
    const service = new CompaniesService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.setUnitPublished(identity, "filial-1", true)).rejects.toThrow("Confirme no mapa");
    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it("o guard REST só aceita o tenant secundário quando o dono confere no banco", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ ...owner, emailVerifiedAt: new Date() }) },
      company: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "filial-1" }),
        findUnique: jest.fn().mockResolvedValue({ isActive: true, subscription: {
          status: SubscriptionStatus.EM_TESTE, trialEndsAt: new Date(Date.now() + 60_000), currentPeriodEnd: null,
        } }),
      },
    };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const guard = new AccountStatusGuard(reflector as never, prisma as never);
    const ctx = { getHandler: () => null, getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: owner.id, role: Role.ADMIN,
        companyId: "filial-1" } }) }) } as never;
    await expect(guard.canActivate(ctx)).rejects.toThrow("Sua sessão não é mais válida");
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: { id: "filial-1", ownerUserId: "owner-1" }, select: { id: true },
    });
  });
});
