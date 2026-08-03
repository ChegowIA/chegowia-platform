import { SearchIntentService } from "../src/ai/search/search-intent.service";
import { AIChatResult } from "../src/ai/providers/ai-provider.interface";

function providerReturning(content: string | null) {
  return { chat: jest.fn().mockResolvedValue({ content, toolCalls: [] } as AIChatResult) };
}

describe("interpretação de busca do marketplace", () => {
  it("expande a busca com os termos que a IA relacionou, sem perder o texto original", async () => {
    const provider = providerReturning(
      JSON.stringify({
        terms: ["lanche", "hamburguer", "burger"],
        productTypeIds: ["hamburgueres-lanches"],
        maxPrice: null,
        explanation: "Busquei lanches e hambúrgueres parecidos com sanduíche.",
      }),
    );
    const service = new SearchIntentService(provider as never);

    const intent = await service.resolve("sanduíche");

    expect(intent.source).toBe("ia");
    expect(intent.terms).toContain("sanduiche"); // o que a pessoa digitou, normalizado
    expect(intent.terms).toEqual(expect.arrayContaining(["lanche", "hamburguer", "burger"]));
    expect(intent.productTypeIds).toEqual(["hamburgueres-lanches"]);
    expect(intent.explanation).toContain("hambúrgueres");
  });

  it("descarta tipos públicos inexistentes devolvidos pelo modelo", async () => {
    const provider = providerReturning(
      JSON.stringify({ terms: ["pizza"], productTypeIds: ["pizzas", "categoria-inventada"], maxPrice: null, explanation: "ok" }),
    );
    const service = new SearchIntentService(provider as never);

    const intent = await service.resolve("pizza");

    expect(intent.productTypeIds).toEqual(["pizzas"]);
  });

  it("lê JSON mesmo quando o modelo embrulha em cerca de código", async () => {
    const provider = providerReturning(
      '```json\n{"terms":["acai"],"productTypeIds":[],"maxPrice":25,"explanation":"Sobremesas geladas."}\n```',
    );
    const service = new SearchIntentService(provider as never);

    const intent = await service.resolve("açaí até 25 reais");

    expect(intent.maxPrice).toBe(25);
    expect(intent.terms).toContain("acai");
  });

  it("cai na expansão determinística quando a IA falha, mantendo a busca utilizável", async () => {
    const provider = { chat: jest.fn().mockRejectedValue(new Error("sem chave de API")) };
    const service = new SearchIntentService(provider as never);

    const intent = await service.resolve("sanduiche");

    expect(intent.source).toBe("fallback");
    // o grupo de sinônimos local cobre o caso sem depender do modelo
    expect(intent.terms).toEqual(expect.arrayContaining(["lanche", "hamburguer", "smash"]));
  });

  it("não chama o modelo duas vezes para a mesma busca", async () => {
    const provider = providerReturning(
      JSON.stringify({ terms: ["sushi"], productTypeIds: [], maxPrice: null, explanation: "Comida japonesa." }),
    );
    const service = new SearchIntentService(provider as never);

    await service.resolve("japonesa");
    const second = await service.resolve("  JAPONESA  "); // mesma consulta após normalizar

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(second.source).toBe("cache");
  });

  it("ignora preço inválido devolvido pelo modelo", async () => {
    const provider = providerReturning(
      JSON.stringify({ terms: ["bolo"], productTypeIds: [], maxPrice: -10, explanation: "Doces." }),
    );
    const service = new SearchIntentService(provider as never);

    const intent = await service.resolve("bolo");

    expect(intent.maxPrice).toBeNull();
  });
});
