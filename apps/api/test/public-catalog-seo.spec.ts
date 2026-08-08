import { CatalogPublicService } from "../src/catalog/catalog-public.service";

describe("catálogo público para SEO", () => {
  it("mantém a página de produto explicitamente presa à empresa do slug", async () => {
    const companyFindFirst = jest.fn().mockResolvedValue({
      id: "empresa-a",
      name: "Loja A",
      slug: "loja-a",
      addressLine: null,
      city: "São Paulo",
      state: "SP",
      logoUrl: null,
      deliveryFeeBase: 5,
      deliveryRadiusKm: 8,
      avgDeliveryTimeMinutes: 35,
      settings: { openingHours: null },
    });
    const productFindFirst = jest.fn().mockResolvedValue({
      id: "produto-a",
      categoryId: "categoria-a",
      name: "Produto A",
      description: null,
      price: 18.5,
      imageUrl: null,
      isActive: true,
      isFeatured: false,
      updatedAt: new Date(),
      category: { id: "categoria-a", name: "Lanches", description: null },
      variations: [],
      addons: [],
    });
    const service = new CatalogPublicService({
      company: { findFirst: companyFindFirst },
      product: { findFirst: productFindFirst },
    } as never);

    await service.getProductBySlugAndId("loja-a", "produto-a");

    expect(productFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "produto-a",
        companyId: "empresa-a",
        isActive: true,
      }),
    }));
  });

  it("publica no sitemap somente catálogo ativo", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogPublicService({ company: { findMany } } as never);

    await service.getSitemapEntries();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true },
      select: expect.objectContaining({
        products: expect.objectContaining({
          where: {
            isActive: true,
            category: { is: { isActive: true } },
          },
        }),
      }),
    }));
  });
});
