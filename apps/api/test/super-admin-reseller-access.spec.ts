import { createHash } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthService } from "../src/auth/auth.service";
import { AccountStatusGuard } from "../src/common/guards/account-status.guard";
import { BlockResellerSupportWriteGuard } from "../src/common/guards/block-reseller-support-write.guard";

describe("acesso auditável do superadmin a revendedores", () => {
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
  const reseller = {
    id: "revendedor-1",
    code: "PARCEIRO1234",
    isActive: false,
    userId: "user-revendedor",
    user: {
      id: "user-revendedor",
      name: "Parceiro Real",
      email: "parceiro@exemplo.com",
      isActive: false,
    },
  };
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
      resellerProfile: { findUnique: jest.fn().mockResolvedValue(reseller) },
      superAdminResellerAccess: {
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

  it("guarda somente hash e envia o segredo no fragmento da rota exclusiva", async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma);

    const result = await service.createResellerAccessLink(identity, reseller.id);
    const url = new URL(result.accessUrl);
    const rawToken = url.hash.slice(1);

    expect(url.origin).toBe("https://chegowia.test");
    expect(url.pathname).toBe("/acesso/suporte/revendedor");
    expect(url.search).toBe("");
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(prisma.superAdminResellerAccess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resellerId: reseller.id,
        superAdminId: superAdmin.id,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      }),
    });
    expect(JSON.stringify(prisma.superAdminResellerAccess.create.mock.calls)).not.toContain(rawToken);
  });

  it("consome uma única vez e preserva o superadmin como ator real", async () => {
    const access = {
      id: "access-1",
      resellerId: reseller.id,
      superAdminId: superAdmin.id,
      linkExpiresAt: new Date(Date.now() + 10 * 60_000),
      consumedAt: null,
      revokedAt: null,
      reseller,
    };
    const prisma = buildPrisma(access);
    const { service, jwtService } = buildService(prisma);

    const result = await service.consumeResellerAccessLink(identity, "a".repeat(43));

    expect(prisma.superAdminResellerAccess.updateMany).toHaveBeenCalledWith({
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
        role: Role.REVENDEDOR,
        companyId: null,
        assumed: true,
        assumedAccessId: access.id,
        assumedAccessKind: "RESELLER",
        assumedUserId: reseller.user.id,
        assumedResellerId: reseller.id,
      }),
      expect.anything(),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: superAdmin.id,
        assumedRole: Role.REVENDEDOR,
        assumedCompanyId: null,
        assumedAccessId: access.id,
        assumedAccessKind: "RESELLER",
        assumedUserId: reseller.user.id,
        assumedResellerId: reseller.id,
      }),
    });
    expect(result.user).toEqual(expect.objectContaining({
      id: superAdmin.id,
      role: Role.REVENDEDOR,
      actorRole: Role.SUPER_ADMIN,
      impersonation: expect.objectContaining({
        resellerId: reseller.id,
        resellerName: reseller.user.name,
        kind: "RESELLER",
        supportAccess: true,
      }),
    }));
  });

  it("recusa atalho de outro superadmin e replay concorrente", async () => {
    const access = {
      id: "access-1",
      resellerId: reseller.id,
      superAdminId: "outro-superadmin",
      linkExpiresAt: new Date(Date.now() + 10 * 60_000),
      consumedAt: null,
      revokedAt: null,
      reseller,
    };
    const prisma = buildPrisma(access);
    const { service } = buildService(prisma);

    await expect(service.consumeResellerAccessLink(identity, "a".repeat(43))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.superAdminResellerAccess.updateMany).not.toHaveBeenCalled();

    access.superAdminId = superAdmin.id;
    prisma.superAdminResellerAccess.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.consumeResellerAccessLink(identity, "a".repeat(43))).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe("proteções de rota", () => {
    function contextFor(token: any) {
      return {
        switchToHttp: () => ({ getRequest: () => ({ user: token }) }),
        getHandler: () => null,
        getClass: () => null,
      } as never;
    }

    it("permite inspecionar perfil inativo apenas com sessão de suporte ainda aberta", async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(superAdmin) },
        superAdminResellerAccess: { findFirst: jest.fn().mockResolvedValue({ id: "access-1" }) },
      };
      const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as never;
      const guard = new AccountStatusGuard(reflector, prisma as never);
      const token = {
        ...identity,
        role: Role.REVENDEDOR,
        companyId: null,
        assumed: true as const,
        assumedAccessId: "access-1",
        assumedAccessKind: "RESELLER" as const,
        assumedUserId: reseller.user.id,
        assumedResellerId: reseller.id,
      };

      await expect(guard.canActivate(contextFor(token))).resolves.toBe(true);
      expect(prisma.superAdminResellerAccess.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: "access-1",
          resellerId: reseller.id,
          superAdminId: superAdmin.id,
          closedAt: null,
        }),
        select: { id: true },
      });

      prisma.superAdminResellerAccess.findFirst.mockResolvedValue(null);
      await expect(guard.canActivate(contextFor(token))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("bloqueia escritas mesmo que a interface seja manipulada", () => {
      const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as never;
      const guard = new BlockResellerSupportWriteGuard(reflector);
      const token = {
        ...identity,
        role: Role.REVENDEDOR,
        companyId: null,
        assumed: true as const,
        assumedAccessId: "access-1",
        assumedAccessKind: "RESELLER" as const,
      };
      expect(() => guard.canActivate(contextFor(token))).toThrow(ForbiddenException);
    });
  });
});
