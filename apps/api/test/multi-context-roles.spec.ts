import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthService } from "../src/auth/auth.service";
import { PermissionsGuard } from "../src/common/guards/permissions.guard";

/**
 * O multiacesso existe para ver o sistema como cada pessoa vê. Isso só funciona
 * se qualquer papel puder ser assumido — e se as permissões acompanharem, já que
 * papel operacional tira permissão do EmployeeProfile, que a conta de plataforma
 * não tem.
 */
describe("papéis do login multiacesso", () => {
  const ALLOWED = "contato@chegowia.com.br";
  const superAdmin = {
    id: "user-super",
    name: "ChegowIA",
    email: ALLOWED,
    role: Role.SUPER_ADMIN,
    companyId: null,
    isActive: true,
  };

  beforeEach(() => {
    process.env.MULTI_CONTEXT_LOGIN_EMAIL = ALLOWED;
  });
  afterEach(() => {
    delete process.env.MULTI_CONTEXT_LOGIN_EMAIL;
  });

  function buildService(company: any = { id: "empresa-1", name: "Empresa 1", isActive: true }) {
    const jwtService = { sign: jest.fn().mockReturnValue("token-assinado") };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(superAdmin) },
      company: {
        findUnique: jest.fn().mockResolvedValue(company),
        findMany: jest.fn().mockResolvedValue([company].filter(Boolean)),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({ id: "refresh-1" }) },
      employeeProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AuthService(prisma as never, jwtService as never, {} as never, {} as never);
    return { service, jwtService, prisma };
  }

  const identity = {
    sub: superAdmin.id,
    email: ALLOWED,
    role: Role.SUPER_ADMIN,
    companyId: null,
    mfaSessionStartedAt: Date.now() - 1_000,
    mfaSessionExpiresAt: Date.now() + 23 * 60 * 60_000,
  };

  it.each([Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM])(
    "assume %s dentro de uma empresa",
    async (role) => {
      const { service, jwtService } = buildService();

      const result = await service.switchContext(identity, "empresa-1", role);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role, companyId: "empresa-1", assumed: true, sub: "user-super" }),
        expect.anything(),
      );
      expect(result.user.role).toBe(role);
    },
  );

  it("assume CLIENTE sem empresa", async () => {
    const { service, jwtService } = buildService();

    const result = await service.switchContext(identity, null, Role.CLIENTE);

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.CLIENTE, companyId: null, assumed: true }),
      expect.anything(),
    );
    expect(result.user.companyId).toBeNull();
  });

  it("exige escolher um revendedor concreto em vez de abrir uma carteira genérica", async () => {
    const { service } = buildService();
    await expect(service.switchContext(identity, null, Role.REVENDEDOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("recusa papel de empresa sem informar empresa", async () => {
    const { service } = buildService();
    await expect(service.switchContext(identity, null, Role.COZINHA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("recusa assumir superadmin dentro de uma empresa", async () => {
    // Seria escalada disfarçada: papel de plataforma com escopo de tenant.
    const { service } = buildService();
    await expect(
      service.switchContext(identity, "empresa-1", Role.SUPER_ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("continua recusando conta fora da lista autorizada", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValue({ ...superAdmin, email: "outro@chegowia.com.br" });

    await expect(service.switchContext(identity, "empresa-1", Role.ADMIN)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("lista os papéis disponíveis por empresa", async () => {
    const { service } = buildService();

    const result = await service.availableContexts(identity);

    const empresa = result.contexts.find((context: any) => context.kind === "COMPANY");
    expect(empresa?.roles).toEqual([Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM]);
    expect(result.contexts.some((context: any) => context.role === Role.REVENDEDOR)).toBe(false);
    expect(result.contexts.some((context: any) => context.role === Role.CLIENTE)).toBe(true);
  });

  describe("permissões do contexto assumido", () => {
    function guardFor(user: any) {
      const reflector = { getAllAndOverride: jest.fn().mockReturnValue(["PEDIDOS_EDITAR"]) } as never;
      const prisma = { employeeProfile: { findUnique: jest.fn().mockResolvedValue(null) } };
      const guard = new PermissionsGuard(reflector, prisma as never);
      const context = {
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => null,
        getClass: () => null,
      } as never;
      return { guard, context, prisma };
    }

    it("libera o papel assumido, que não tem vínculo de funcionário", async () => {
      // Sem isto, entrar como cozinha mostraria uma tela vazia.
      const { guard, context } = guardFor({
        sub: "user-super",
        role: Role.COZINHA,
        companyId: "empresa-1",
        assumed: true,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it("mantém a exigência para funcionário de verdade", async () => {
      const { guard, context } = guardFor({ sub: "user-comum", role: Role.COZINHA, companyId: "empresa-1" });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
