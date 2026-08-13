import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Com a assinatura bloqueada o AccountStatusGuard recusa as rotas da empresa.
 * Algumas precisam continuar respondendo, senão a pessoa fica presa: sem sair da
 * conta, sem trocar de contexto e sem recuperar a senha — só restaria limpar o
 * navegador na mão.
 *
 * O teste lê o controller porque o que importa é a marcação estar na rota; um
 * teste de unidade do guard não pegaria alguém removendo o decorator.
 */
describe("rotas que sobrevivem ao bloqueio de assinatura", () => {
  const fonte = readFileSync(
    join(__dirname, "..", "src", "auth", "auth.controller.ts"),
    "utf8",
  );

  function trechoAntesDe(rota: string) {
    const indice = fonte.indexOf(rota);
    expect(indice).toBeGreaterThan(-1);
    // Olha só o bloco de decorators imediatamente acima da rota.
    return fonte.slice(Math.max(0, indice - 500), indice);
  }

  it.each([
    ['@Post("logout")', "sair da conta"],
    ['@Get("me")', "saber quem está logado"],
    ['@Post("change-password")', "recuperar a conta"],
    ['@Post("context")', "trocar de contexto"],
    ['@Get("contexts")', "listar contextos"],
  ])("%s continua acessível — é como se %s", (rota) => {
    expect(trechoAntesDe(rota)).toContain("@AllowInactiveSubscription()");
  });

  it("o login não depende do decorator, porque é rota pública", () => {
    expect(trechoAntesDe('@Post("login")')).toContain("@Public()");
  });
});
