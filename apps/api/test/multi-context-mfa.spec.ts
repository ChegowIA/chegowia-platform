import { AuthController } from "../src/auth/auth.controller";

/**
 * Em produção o superadmin sempre passa por MFA. Se a resposta do código não
 * carregar `multiContext`, o seletor de contexto nunca aparece — o recurso
 * simplesmente não existe para quem ele foi feito, sem erro nenhum.
 *
 * Foi o que aconteceu: o serviço devolvia o campo e o controller o descartava ao
 * montar a resposta.
 */
describe("resposta do login para o multiacesso", () => {
  function build(serviceResult: Record<string, unknown>) {
    const authService = {
      login: jest.fn().mockResolvedValue(serviceResult),
      verifyMfa: jest.fn().mockResolvedValue(serviceResult),
    };
    const res = { cookie: jest.fn() } as never;
    return { controller: new AuthController(authService as never), res };
  }

  const base = {
    accessToken: "token",
    refreshTokenCookie: "cookie",
    refreshTokenExpiresAt: new Date(),
    user: { id: "user-1", role: "SUPER_ADMIN" },
  };

  it("repassa multiContext na conclusão do MFA", async () => {
    const { controller, res } = build({ ...base, multiContext: true });

    const result = await controller.verifyMfa({ challengeId: "c1", code: "123456" } as never, res);

    expect(result).toEqual(expect.objectContaining({ multiContext: true }));
  });

  it("repassa multiContext no login sem MFA", async () => {
    const { controller, res } = build({ ...base, mfaRequired: false, multiContext: true });

    const result = await controller.login({ email: "a@b.c", password: "x" } as never, res);

    expect(result).toEqual(expect.objectContaining({ multiContext: true }));
  });

  it("não promete multiacesso para conta comum", async () => {
    const { controller, res } = build({ ...base, multiContext: false });

    const result = await controller.verifyMfa({ challengeId: "c1", code: "123456" } as never, res);

    expect(result).toEqual(expect.objectContaining({ multiContext: false }));
  });
});
