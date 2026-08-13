import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthService } from "../src/auth/auth.service";
import { AccountStatusGuard } from "../src/common/guards/account-status.guard";

/**
 * O login multiacesso emite um token cujo papel diverge do papel gravado no
 * banco. Estes testes fixam as duas travas que impedem isso de virar escalada de
 * privilégio: só um e-mail configurado por ambiente pode assumir contexto, e a
 * origem é reconferida a cada requisição.
 */
describe("login multiacesso do superadmin", () => {
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

  beforeEach(() => {
    process.env.MULTI_CONTEXT_LOGIN_EMAIL = ALLOWED;
  });
  afterEach(() => {
    delete process.env.MULTI_CONTEXT_LOGIN_EMAIL;
  });

  function buildAuthService(prisma: any) {
    const jwtService = { sign: jest.fn().mockReturnValue("token-assinado") };
    return new AuthService(
      prisma as never,
      jwtService as never,
      {} as never,
      {} as never,
    );
  }

  function basePrisma(user: any, company?: any) {
    return {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      company: {
        findUnique: jest.fn().mockResolvedValue(company ?? null),
        findMany: jest.fn().mockResolvedValue(company ? [company] : []),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({ id: "refresh-1" }) },
      employeeProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  }

  it("recusa troca de contexto para e-mail fora da lista, mesmo sendo SUPER_ADMIN", async () => {
    const outro = { ...superAdmin, id: "user-outro", email: "outro.super@chegowia.com.br" };
    const service = buildAuthService(basePrisma(outro, { id: "empresa-1", name: "Empresa 1", isActive: true }));

    await expect(
      service.switchContext({ sub: outro.id, email: outro.email, role: Role.SUPER_ADMIN, companyId: null }, "empresa-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("recusa troca de contexto para conta que não é SUPER_ADMIN, mesmo com o e-mail certo", async () => {
    const admin = { ...superAdmin, id: "user-admin", role: Role.ADMIN, companyId: "empresa-9" };
    const service = buildAuthService(basePrisma(admin, { id: "empresa-1", name: "Empresa 1", isActive: true }));

    await expect(
      service.switchContext({ sub: admin.id, email: admin.email, role: Role.ADMIN, companyId: "empresa-9" }, "empresa-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("não lista contextos para contas comuns, então a rota não revela empresas", async () => {
    const admin = { ...superAdmin, id: "user-admin", role: Role.ADMIN, companyId: "empresa-9" };
    const prisma = basePrisma(admin, { id: "empresa-1", name: "Empresa 1", isActive: true });
    const service = buildAuthService(prisma);

    const result = await service.availableContexts({
      sub: admin.id,
      email: admin.email,
      role: Role.ADMIN,
      companyId: "empresa-9",
    });

    expect(result).toEqual({ multiContext: false, contexts: [] });
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  it("emite token de ADMIN da empresa mantendo o superadmin no sub, para auditoria", async () => {
    const company = { id: "empresa-1", name: "Empresa 1", isActive: true };
    const prisma = basePrisma(superAdmin, company);
    const jwtService = { sign: jest.fn().mockReturnValue("token-assinado") };
    const service = new AuthService(prisma as never, jwtService as never, {} as never, {} as never);

    const result = await service.switchContext(
      { sub: superAdmin.id, email: ALLOWED, role: Role.SUPER_ADMIN, companyId: null },
      "empresa-1",
    );

    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: "user-super", email: ALLOWED, role: Role.ADMIN, companyId: "empresa-1", assumed: true },
      expect.anything(),
    );
    // O contexto assumido é gravado no refresh para sobreviver à renovação.
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assumedRole: Role.ADMIN, assumedCompanyId: "empresa-1" }),
      }),
    );
    expect(result.user.role).toBe(Role.ADMIN);
    expect(result.user.companyId).toBe("empresa-1");
  });

  it("recusa empresa inativa", async () => {
    const prisma = basePrisma(superAdmin, { id: "empresa-1", name: "Empresa 1", isActive: false });
    const service = buildAuthService(prisma);

    await expect(
      service.switchContext({ sub: superAdmin.id, email: ALLOWED, role: Role.SUPER_ADMIN, companyId: null }, "empresa-1"),
    ).rejects.toThrow();
  });

  describe("AccountStatusGuard com token de contexto assumido", () => {
    function buildContext(identity: any) {
      return {
        switchToHttp: () => ({ getRequest: () => ({ user: identity }) }),
        getHandler: () => null,
        getClass: () => null,
      } as never;
    }
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as never;

    it("aceita o token enquanto a conta continua superadmin autorizada", async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(superAdmin) },
        company: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            subscription: { status: "ATIVA", trialEndsAt: null },
          }),
        },
      };
      const guard = new AccountStatusGuard(reflector, prisma as never);

      await expect(
        guard.canActivate(
          buildContext({ sub: superAdmin.id, email: ALLOWED, role: Role.ADMIN, companyId: "empresa-1", assumed: true }),
        ),
      ).resolves.toBe(true);
    });

    it("bloqueia a rota assumida quando o período da assinatura já terminou", async () => {
      const originalEnforcement = process.env.BILLING_ENFORCEMENT;
      process.env.BILLING_ENFORCEMENT = "true";
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(superAdmin) },
        company: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            subscription: {
              status: "ATIVA",
              trialEndsAt: null,
              currentPeriodEnd: new Date(Date.now() - 1_000),
            },
          }),
        },
      };
      const guard = new AccountStatusGuard(reflector, prisma as never);

      try {
        await expect(
          guard.canActivate(
            buildContext({ sub: superAdmin.id, email: ALLOWED, role: Role.ADMIN, companyId: "empresa-1", assumed: true }),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      } finally {
        if (originalEnforcement === undefined) delete process.env.BILLING_ENFORCEMENT;
        else process.env.BILLING_ENFORCEMENT = originalEnforcement;
      }
    });

    it("derruba a sessão assumida se a conta deixar de ser superadmin", async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ ...superAdmin, role: Role.ADMIN }) },
        company: { findUnique: jest.fn() },
      };
      const guard = new AccountStatusGuard(reflector, prisma as never);

      await expect(
        guard.canActivate(
          buildContext({ sub: superAdmin.id, email: ALLOWED, role: Role.ADMIN, companyId: "empresa-1", assumed: true }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("derruba a sessão assumida se o e-mail sair da variável de ambiente", async () => {
      process.env.MULTI_CONTEXT_LOGIN_EMAIL = "outro@chegowia.com.br";
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(superAdmin) },
        company: { findUnique: jest.fn() },
      };
      const guard = new AccountStatusGuard(reflector, prisma as never);

      await expect(
        guard.canActivate(
          buildContext({ sub: superAdmin.id, email: ALLOWED, role: Role.ADMIN, companyId: "empresa-1", assumed: true }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("mantém a comparação estrita para tokens normais", async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ ...superAdmin, role: Role.SUPER_ADMIN }) },
        company: { findUnique: jest.fn() },
      };
      const guard = new AccountStatusGuard(reflector, prisma as never);

      // Token diz ADMIN de uma empresa, mas não é assumido: continua recusado.
      await expect(
        guard.canActivate(
          buildContext({ sub: superAdmin.id, email: ALLOWED, role: Role.ADMIN, companyId: "empresa-1" }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
