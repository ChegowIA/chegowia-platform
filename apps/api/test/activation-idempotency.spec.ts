import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A Stripe recusa a mesma chave de idempotência com corpo diferente. A chave da
 * ativação era derivada de `updatedAt`, o que parecia suficiente — até um preço
 * ser alterado fora do Prisma (correção manual, migração de dados): o carimbo
 * ficava no passado, a chave se repetia com parâmetros novos, e a ativação
 * falhava com erro que não dizia nada disso.
 *
 * O teste lê a fonte porque o que importa é de onde a chave vem, e exercitar o
 * checkout exigiria a Stripe de verdade.
 */
describe("chave de idempotência da ativação", () => {
  const fonte = readFileSync(
    join(__dirname, "..", "src", "billing", "billing.service.ts"),
    "utf8",
  );
  // A âncora inclui o primeiro parâmetro porque `async companyCheckout` sozinho
  // casaria com `companyCheckoutAsaas`, que é o caminho do outro provedor e não
  // usa chave de idempotência. Não repetimos a assinatura inteira: ela ganha
  // parâmetros com o tempo, e quando isso aconteceu o teste passou a ler string
  // vazia e a aprovar qualquer coisa.
  const inicio = fonte.indexOf("async companyCheckout(companyId");
  if (inicio < 0) throw new Error("companyCheckout não encontrado em billing.service.ts");
  const trecho = fonte.slice(inicio);
  const corpo = trecho.slice(0, trecho.indexOf("\n  async "));

  it("não deriva a chave de updatedAt", () => {
    expect(corpo).not.toMatch(/idempotencyKey:[^}]*updatedAt/);
  });

  it("deriva a chave dos parâmetros que compõem a sessão", () => {
    // Preço, moeda, origem do preço, cliente e revendedor: tudo que, mudando,
    // produz um corpo diferente na Stripe.
    expect(corpo).toContain("activationFingerprint");
    expect(corpo).toMatch(/Math\.round\(monthlyPrice \* 100\)/);
    expect(corpo).toContain("subscription.plan.currency");
    expect(corpo).toContain("canUseStoredStripePrice");
    expect(corpo).toContain("subscription.resellerId");
  });

  it("mantém a assinatura no prefixo, para a chave seguir sendo por empresa", () => {
    expect(corpo).toMatch(/trial-activation-\$\{subscription\.id\}/);
  });
});
