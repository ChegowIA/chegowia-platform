import { CatalogPublicService } from "../src/catalog/catalog-public.service";

/**
 * A home carregava o catálogo inteiro de todas as empresas ativas — a consulta
 * principal não tinha `take`. É rota pública e anônima, então o custo era pago
 * a cada visita.
 */
describe("varrimento da home do marketplace", () => {
  function produto(id: string, nome: string, categoria: string) {
    return {
      id,
      name: nome,
      description: "",
      price: 25,
      imageUrl: null,
      isFeatured: false,
      category: { id: `cat-${id}`, name: categoria, description: null },
      company: {
        id: "empresa-1",
        name: "Loja",
        slug: "loja",
        city: "Belo Horizonte",
        state: "MG",
        logoUrl: null,
        deliveryFeeBase: 5,
        avgDeliveryTimeMinutes: 30,
      },
    };
  }

  function build(resultados: any[] = []) {
    const findMany = jest.fn().mockResolvedValue(resultados);
    const service = new CatalogPublicService({ product: { findMany } } as never);
    return { service, findMany };
  }

  it("limita a consulta principal em vez de ler o catálogo inteiro", async () => {
    const { service, findMany } = build();

    await service.getMarketplace({});

    const principal = findMany.mock.calls[0][0];
    expect(principal.take).toBe(600);
    expect(principal.orderBy).toEqual([{ isFeatured: "desc" }, { updatedAt: "desc" }]);
  });

  it("nenhuma consulta da home fica sem teto", async () => {
    const { service, findMany } = build();

    await service.getMarketplace({ categoryId: "pizzas" });

    expect(findMany).toHaveBeenCalledTimes(3);
    for (const [args] of findMany.mock.calls) expect(args.take).toBeGreaterThan(0);
  });

  it("com tipo selecionado, enviesa a janela pelas keywords do tipo", async () => {
    const { service, findMany } = build();

    await service.getMarketplace({ categoryId: "pizzas" });

    const enviesada = findMany.mock.calls[1][0];
    const alvos = JSON.stringify(enviesada.where.AND);
    expect(alvos).toContain("pizza");
    expect(alvos).toContain("calzone");
  });

  it("tipo dinâmico, sem keywords, não gera consulta extra", async () => {
    const { service, findMany } = build();

    await service.getMarketplace({ categoryId: "tipo-comida-mineira" });

    // só a principal e a de destaques: a enviesada é pulada
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("os chips saem da janela sem viés, para os outros tipos não sumirem", async () => {
    const findMany = jest.fn()
      .mockResolvedValueOnce([produto("1", "Pizza Calabresa", "Pizzas"), produto("2", "X-Salada", "Lanches")])
      .mockResolvedValueOnce([produto("1", "Pizza Calabresa", "Pizzas")])
      .mockResolvedValueOnce([]);
    const service = new CatalogPublicService({ product: { findMany } } as never);

    const resultado = await service.getMarketplace({ categoryId: "pizzas" });

    expect(resultado.productTypes.map((type: any) => type.id).sort()).toEqual(["hamburgueres-lanches", "pizzas"]);
    expect(resultado.sections).toHaveLength(1);
    expect(resultado.sections[0].categoryId).toBe("pizzas");
  });

  /**
   * Igualdade, e não `contains`: com substring, um cliente em "Rio Branco"
   * receberia lojas de "Rio Branco do Sul", que fica em outro estado. Acento e
   * caixa continuam sendo ignorados pela collation da coluna.
   */
  it("filtra a cidade por igualdade nas três consultas, sem sobrescrever o filtro da empresa", async () => {
    const { service, findMany } = build();

    await service.getMarketplace({ city: "Belo Horizonte", categoryId: "pizzas" });

    for (const [args] of findMany.mock.calls) {
      expect(args.where.company.is).toMatchObject({ isActive: true, city: "Belo Horizonte" });
    }
  });
});
