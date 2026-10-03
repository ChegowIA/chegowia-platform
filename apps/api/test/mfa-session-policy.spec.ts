import { UnauthorizedException } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AuthService } from "../src/auth/auth.service";
import { createMfaSessionWindow } from "../src/common/security/mfa-session";
import { JwtStrategy } from "../src/auth/strategies/jwt.strategy";

describe("política universal de MFA e sessão de 24 horas", () => {
  const user = {
    id: "user-1",
    name: "Pessoa Real",
    email: "pessoa@exemplo.com",
    role: Role.CLIENTE,
    companyId: null,
    avatarUrl: null,
    isActive: true,
    emailVerifiedAt: new Date(),
  };

  function serviceWith(prisma: any, jwtService = { sign: jest.fn().mockReturnValue("jwt-assinado") }) {
    return { service: new AuthService(prisma as never, jwtService as never, {} as never, {} as never), jwtService };
  }

  it("exige código de todos os perfis reais, sem depender da variável por cargo", () => {
    const { service } = serviceWith({});

    for (const role of Object.values(Role)) {
      expect((service as any).requiresMfa({ email: `perfil-${role.toLowerCase()}@exemplo.com` })).toBe(true);
    }
    // O domínio .invalid só pode ser criado pelo script de infraestrutura e
    // existe para permitir demonstrar a operação sem uma caixa postal falsa.
    expect((service as any).requiresMfa({ email: "motoboy@demo.chegowia.invalid" })).toBe(false);
  });

  it("mantém a mesma data final ao renovar, sem transformar 24h em sessão deslizante", async () => {
    const secret = "segredo-de-refresh";
    const startedAt = new Date(Date.now() - 30 * 60_000);
    const expiresAt = new Date(Date.now() + 23 * 60 * 60_000);
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: "refresh-antigo",
          userId: user.id,
          tokenHash: await bcrypt.hash(secret, 10),
          expiresAt,
          sessionStartedAt: startedAt,
          revokedAt: null,
          assumedRole: null,
          assumedCompanyId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: "refresh-novo" }),
      },
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      employeeProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service } = serviceWith(prisma);

    const result = await service.refresh(`refresh-antigo.${secret}`);

    expect(result.sessionExpiresAt).toEqual(expiresAt);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt,
        sessionStartedAt: startedAt,
      }),
    });
  });

  it("recusa cookie emitido antes da sessão confirmada por MFA", async () => {
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cookie-legado",
          userId: user.id,
          tokenHash: "nao-importa",
          expiresAt: new Date(Date.now() + 60 * 60_000),
          sessionStartedAt: null,
          revokedAt: null,
        }),
        updateMany: jest.fn(),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(service.refresh("cookie-legado.segredo")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("recusa imediatamente um access token legado sem a janela MFA", async () => {
    const strategy = new JwtStrategy();
    await expect(strategy.validate({
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: null,
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("não cria sessão ao apenas confirmar o e-mail", async () => {
    const tx = {
      accountToken: { update: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue(user) },
    };
    const prisma = {
      accountToken: {
        findFirst: jest.fn().mockResolvedValue({ id: "verification-1", userId: user.id }),
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
      refreshToken: { create: jest.fn() },
    };
    const { service, jwtService } = serviceWith(prisma);

    await expect(service.verifyEmail("link-de-confirmacao")).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
    expect(tx.accountToken.update).toHaveBeenCalledWith({
      where: { id: "verification-1" },
      data: { usedAt: expect.any(Date) },
    });
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("emite o marcador e a validade máxima de 24h somente na sessão nova", async () => {
    const prisma = {
      refreshToken: { create: jest.fn().mockResolvedValue({ id: "refresh-1" }) },
    };
    const { service, jwtService } = serviceWith(prisma);
    const startedAt = new Date(Date.now() - 1_000);
    const session = createMfaSessionWindow(startedAt);

    const result = await (service as any).issueTokens(user, session);

    expect(result.sessionExpiresAt.getTime() - startedAt.getTime()).toBe(24 * 60 * 60_000);
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        mfaSessionStartedAt: startedAt.getTime(),
        mfaSessionExpiresAt: result.sessionExpiresAt.getTime(),
      }),
      expect.anything(),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionStartedAt: startedAt, expiresAt: result.sessionExpiresAt }),
    });
  });
});
