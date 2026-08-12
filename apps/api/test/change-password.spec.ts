import { UnauthorizedException } from "@nestjs/common";
import { AccountTokenType } from "@prisma/client";
import { AuthService } from "../src/auth/auth.service";

/**
 * A troca de senha de quem está logado não pede a senha atual: o que autoriza é
 * a posse do e-mail. Estes testes fixam as consequências disso — invalidar links
 * anteriores, não confirmar o endereço de e-mail na resposta, e recusar conta
 * inativa.
 */
describe("troca de senha de usuário logado", () => {
  const user = {
    id: "user-1",
    name: "Thiago",
    email: "contato@chegowia.com.br",
    isActive: true,
  };

  function buildService(overrides: { user?: any } = {}) {
    const accountToken = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: "token-1" }),
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue("user" in overrides ? overrides.user : user) },
      accountToken,
    };
    const mail = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(prisma as never, {} as never, mail as never, {} as never);
    return { service, prisma, accountToken, mail };
  }

  it("envia o link e invalida pedidos anteriores ainda abertos", async () => {
    const { service, accountToken, mail } = buildService();

    const result = await service.requestPasswordChange("user-1");

    expect(accountToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          type: AccountTokenType.REDEFINICAO_SENHA,
          usedAt: null,
        }),
      }),
    );
    expect(mail.sendPasswordReset).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("mascara o e-mail, para não confirmar o endereço a quem usa sessão alheia", async () => {
    const { service } = buildService();

    const result = await service.requestPasswordChange("user-1");

    expect(result.emailHint).not.toContain("contato@");
    expect(result.emailHint).toBe("co***@chegowia.com.br");
  });

  it("recusa conta inativa sem enviar e-mail", async () => {
    const { service, mail } = buildService({ user: { ...user, isActive: false } });

    await expect(service.requestPasswordChange("user-1")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("recusa usuário inexistente", async () => {
    const { service, mail } = buildService({ user: null });

    await expect(service.requestPasswordChange("some-id")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("não deixa falha de e-mail derrubar a operação", async () => {
    const { service, mail } = buildService();
    mail.sendPasswordReset.mockRejectedValueOnce(new Error("SMTP fora do ar"));

    // O token já foi gravado; estourar aqui deixaria o usuário sem resposta e
    // com um link válido que ele não sabe que existe.
    await expect(service.requestPasswordChange("user-1")).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
  });
});
