import { createHash } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AuthService } from "../src/auth/auth.service";
import { AccountStatusGuard } from "../src/common/guards/account-status.guard";

describe("atalho auditável de suporte do superadmin", () => {
  const ALLOWED = "contato@chegowia.com.br";
  const superAdmin = {
    id: "user-super",
    name: "ChegowIA",
    email: ALLOWED,
    role: Role.SUPER_ADMIN,
    companyId: null,
    isActive: true,
    emailVerifiedAt: new Date(),
  };
  const company = { id: "empresa-1", name: "Empresa 1", isActive: false };
  const identity = {
    sub: superAdmin.id,
    email: ALLOWED,
    role: Role.SUPER_ADMIN,
    companyId: null,
    mfaSessionStartedAt: Date.now() - 1_000,
    mfaSessionExpiresAt: Date.now() + 23 * 60 * 60_000,
  };
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    process.env.MULTI_CONTEXT_LOGIN_EMAIL = ALLOWED;
    process.env.APP_URL = "https://chegowia.test";
  });

  afterEach(() => {
    delete process.env.MULTI_CONTEXT_LOGIN_EMAIL;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  function buildPrisma(access?: any) {
    return {
      user: { findUnique: jest.fn().mockResolvedValue(superAdmin) },
      company: { findUnique: jest.fn().mockResolvedValue(company) },
      superAdminCompanyAccess: {
        create: jest.fn().mockResolvedValue({ id: "access-1" }),
        findUnique: jest.fn().mockResolvedValue(access ?? null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({ id: "refresh-1" }) },
      employeeProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  }

  function buildService(prisma: any) {
    const jwtService = { sign: jest.fn().mockReturnValue("token-assinado") };
    return { service: new AuthService(prisma as never, jwtService as never, {} as never, {} as never), jwtService };
  }

  it("guarda somente o hash de um link de uso único, nunca o segredo da URL", async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma);

    const result = await service.createCompanyAdminAccessLink(identity, company.id);
    const url = new URL(result.accessUrl);
    const rawToken = url.hash.slice(1);

    expect(url.origin).toBe("https://chegowia.test");
    expect(url.pathname).toBe("/acesso/suporte");
    expect(url.search).toBe("");
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(prisma.superAdminCompanyAccess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: company.id,
        superAdminId: superAdmin.id,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      }),
    });
    expect(JSON.stringify(prisma.superAdminCompanyAccess.create.mock.calls)).not.toContain(rawToken);
  });

  it("consome uma única vez, mantém o ator real e limita o refresh à sessão de suporte", async () => {
    const access = {
      id: "access-1",
      companyId: company.id,
      superAdminId: superAdmin.id,
      linkExpiresAt: new Date(Date.now() + 10 * 60_000),
      consumedAt: null,
      revokedAt: null,
      company,
    };
    const prisma = buildPrisma(access);
    const { service, jwtService } = buildService(prisma);

    const result = await service.consumeCompanyAdminAccessLink(identity, "a".repeat(43));

    expect(prisma.superAdminCompanyAccess.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: access.id,
        superAdminId: superAdmin.id,
        consumedAt: null,
        revokedAt: null,
      }),
      data: expect.objectContaining({ consumedAt: expect.any(Date), sessionExpiresAt: expect.any(Date) }),
    });
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: superAdmin.id,
        role: Role.ADMIN,
        companyId: company.id,
        assumed: true,
        assumedAccessId: access.id,
      }),
      expect.anything(),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assumedRole: Role.ADMIN,
        assumedCompanyId: company.id,
        assumedAccessId: access.id,
        expiresAt: expect.any(Date),
      }),
    });
    expect(result.user).toEqual(expect.objectContaining({
      role: Role.ADMIN,
      companyId: company.id,
      actorRole: Role.SUPER_ADMIN,
      impersonation: expect.objectContaining({ companyId: company.id, supportAccess: true }),
    }));
  });

  it("renova a visão de suporte apenas enquanto a auditoria continuar aberta e dentro do prazo", async () => {
    const secret = "segredo-de-refresh";
    const sessionExpiresAt = new Date(Date.now() + 45 * 60_000);
    const access = {
      id: "access-1",
      companyId: company.id,
      superAdminId: superAdmin.id,
      sessionExpiresAt,
      company,
    };
    const prisma = buildPrisma(access);
    (prisma.refreshToken as any).findUnique = jest.fn().mockResolvedValue({
      id: "refresh-antigo",
      userId: superAdmin.id,
      tokenHash: await bcrypt.hash(secret, 10),
      expiresAt: new Date(Date.now() + 50 * 60_000),
      sessionStartedAt: new Date(Date.now() - 1_000),
      revokedAt: null,
      assumedRole: Role.ADMIN,
      assumedCompanyId: company.id,
      assumedAccessId: access.id,
    });
    (prisma.refreshToken as any).updateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.superAdminCompanyAccess as any).findFirst = jest.fn().mockResolvedValue(access);
    const { service, jwtService } = buildService(prisma);

    const result = await service.refresh(`refresh-antigo.${secret}`);

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ assumed: true, assumedAccessId: access.id, companyId: company.id }),
      expect.anything(),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ assumedAccessId: access.id, expiresAt: sessionExpiresAt }),
    });
    expect(result.user).toEqual(expect.objectContaining({
      role: Role.ADMIN,
      actorRole: Role.SUPER_ADMIN,
      impersonation: expect.objectContaining({ supportAccess: true }),
    }));
  });

  it("recusa replay e atalho criado para outro superadmin", async () => {
    const access = {
      id: "access-1",
      companyId: company.id,
      superAdminId: "outro-superadmin",
      linkExpiresAt: new Date(Date.now() + 10 * 60_000),
      consumedAt: null,
      revokedAt: null,
      company,
    };
    const prisma = buildPrisma(access);
    const { service } = buildService(prisma);

    await expect(service.consumeCompanyAdminAccessLink(identity, "a".repeat(43))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.superAdminCompanyAccess.updateMany).not.toHaveBeenCalled();

    access.superAdminId = superAdmin.id;
    prisma.superAdminCompanyAccess.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.consumeCompanyAdminAccessLink(identity, "a".repeat(43))).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe("AccountStatusGuard", () => {
    function contextFor(token: any) {
      return {
        switchToHttp: () => ({ getRequest: () => ({ user: token }) }),
        getHandler: () => null,
        getClass: () => null,
      } as never;
    }

    it("só libera empresa inativa para uma sessão de suporte auditada e não encerrada", async () => {
      const originalEnforcement = process.env.BILLING_ENFORCEMENT;
      process.env.BILLING_ENFORCEMENT = "true";
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(superAdmin) },
        superAdminCompanyAccess: {
          findFirst: jest.fn().mockResolvedValue({ id: "access-1" }),
        },
        company: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: false,
            subscription: { status: "INADIMPLENTE", trialEndsAt: null, currentPeriodEnd: null },
          }),
        },
      };
      const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as never;
      const guard = new AccountStatusGuard(reflector, prisma as never);
      const supportToken = {
        ...identity,
        role: Role.ADMIN,
        companyId: company.id,
        assumed: true as const,
        assumedAccessId: "access-1",
      };

      try {
        await expect(guard.canActivate(contextFor(supportToken))).resolves.toBe(true);
        expect(prisma.superAdminCompanyAccess.findFirst).toHaveBeenCalledWith({
          where: expect.objectContaining({
            id: "access-1",
            superAdminId: superAdmin.id,
            companyId: company.id,
            closedAt: null,
          }),
          select: { id: true },
        });

        prisma.superAdminCompanyAccess.findFirst.mockResolvedValue(null);
        await expect(guard.canActivate(contextFor(supportToken))).rejects.toBeInstanceOf(UnauthorizedException);
      } finally {
        if (originalEnforcement === undefined) delete process.env.BILLING_ENFORCEMENT;
        else process.env.BILLING_ENFORCEMENT = originalEnforcement;
      }
    });
  });
});
