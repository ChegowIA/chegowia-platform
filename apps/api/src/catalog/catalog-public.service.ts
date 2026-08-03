import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { PUBLIC_PRODUCT_TYPES, inferPublicProductType } from "./public-product-types";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";

/** Teto do varrimento da home. Ver o comentário de `getMarketplace`. */
const MARKETPLACE_SCAN_LIMIT = 600;
const SECTION_LIMIT = 8;
const PRODUCTS_PER_SECTION = 8;

const MARKETPLACE_PRODUCT_INCLUDE = {
  category: true,
  company: {
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      state: true,
      logoUrl: true,
      deliveryFeeBase: true,
      avgDeliveryTimeMinutes: true,
    },
  },
};

@Injectable()
export class CatalogPublicService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  /** Cardápio público de uma empresa pelo slug — usado na loja `/loja/[slug]`. */
  async getMenuBySlug(slug: string) {
    const company = await this.db().company.findFirst({ where: { slug, isActive: true } });
    if (!company) throw new NotFoundException("Loja não encontrada.");

    return tenantContext.runAsCompany(company.id, async () => {
      const categories = await this.db().category.findMany({
        where: { isActive: true },
        orderBy: { position: "asc" },
        include: {
          products: {
            where: { isActive: true },
            include: { variations: { where: { isActive: true } }, addons: { where: { isActive: true } } },
          },
        },
      });
      return { company: { id: company.id, name: company.name, slug: company.slug }, categories };
    });
  }

  /**
   * Monta a home do marketplace: chips de tipo, destaques e seções.
   *
   * O tipo público é inferido em memória (`inferPublicProductType`), com
   * precedência pela ordem da taxonomia e criação dinâmica a partir do nome da
   * categoria da empresa. Isso não tem equivalente em SQL, então classificar
   * aqui é inevitável. O que não podia continuar era ler **tudo**: a consulta
   * não tinha `take` e cada visita anônima à home carregava o catálogo inteiro
   * de todas as empresas ativas, com categoria e empresa incluídas.
   *
   * A janela abaixo é ordenada por destaque e recência e dá folga de sobra para
   * as no máximo 8 seções × 8 produtos que a página exibe. Busca de verdade é
   * `searchPublic`, paginada em SQL.
   */
  async getMarketplace(params: { search?: string; city?: string; categoryId?: string }) {
    const search = params.search?.trim();
    const city = params.city?.trim();
    const publicTypeId = params.categoryId?.trim();

    const companyFilter = city ? { isActive: true, city: { contains: city } } : { isActive: true };
    const productWhere: any = {
      isActive: true,
      company: { is: companyFilter },
      category: { is: { isActive: true } },
    };

    if (search) {
      productWhere.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { category: { is: { name: { contains: search } } } },
        { company: { is: { name: { contains: search } } } },
      ];
    }

    const scanArgs = {
      where: productWhere,
      orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
      take: MARKETPLACE_SCAN_LIMIT,
      include: MARKETPLACE_PRODUCT_INCLUDE,
    };

    /**
     * Com um tipo selecionado, a janela sem viés poderia não conter nenhum
     * produto daquele tipo — antes o varrimento era completo e isso não
     * acontecia. As keywords do tipo entram como filtro SQL para encher a
     * janela do lado certo; a classificação final continua sendo a inferida,
     * então um produto que casou por palavra mas pertence a outro tipo é
     * descartado depois. Tipos dinâmicos não têm keywords e caem na janela
     * comum.
     */
    const typeKeywords = publicTypeId
      ? PUBLIC_PRODUCT_TYPES.find((type) => type.id === publicTypeId)?.keywords ?? []
      : [];
    const biasedWhere = typeKeywords.length
      ? {
        ...productWhere,
        AND: [{
          OR: typeKeywords.flatMap((keyword) => [
            { name: { contains: keyword } },
            { description: { contains: keyword } },
            { category: { is: { name: { contains: keyword } } } },
          ]),
        }],
      }
      : null;

    const [products, biasedProducts, featuredProducts] = await Promise.all([
      this.db().product.findMany(scanArgs),
      biasedWhere
        ? this.db().product.findMany({ ...scanArgs, where: biasedWhere })
        : Promise.resolve(null),
      this.db().product.findMany({
        where: {
          isActive: true,
          isFeatured: true,
          company: { is: companyFilter },
          category: { is: { isActive: true } },
        },
        take: 10,
        orderBy: { updatedAt: "desc" },
        include: MARKETPLACE_PRODUCT_INCLUDE,
      }),
    ]);

    const allNormalizedProducts: any[] = products.map(normalizeMarketplaceProduct);
    // Os chips saem sempre da janela sem viés: com o viés, escolher um tipo
    // faria os outros sumirem da barra e não haveria como voltar.
    const sectionSource: any[] = biasedProducts
      ? biasedProducts.map(normalizeMarketplaceProduct)
      : allNormalizedProducts;
    const normalizedProducts = publicTypeId
      ? sectionSource.filter((product) => product.publicType.id === publicTypeId)
      : allNormalizedProducts;
    const normalizedFeaturedProducts = featuredProducts
      .map(normalizeMarketplaceProduct)
      .filter((product: any) => !publicTypeId || product.publicType.id === publicTypeId);

    const typeMap = new Map<
      string,
      { id: string; name: string; description: string; icon: string; sortOrder: number }
    >();
    for (const product of allNormalizedProducts) {
      if (!typeMap.has(product.publicType.id)) typeMap.set(product.publicType.id, product.publicType);
    }

    const sectionsMap = new Map<
      string,
      { categoryId: string; categoryName: string; description?: string | null; icon: string; products: any[] }
    >();
    for (const product of normalizedProducts) {
      const key = product.publicType.id;
      const section = sectionsMap.get(key) ?? {
        categoryId: product.publicType.id,
        categoryName: product.publicType.name,
        description: product.publicType.description,
        icon: product.publicType.icon,
        products: [] as any[],
      };
      if (section.products.length < PRODUCTS_PER_SECTION) section.products.push(product);
      sectionsMap.set(key, section);
    }

    return {
      productTypes: Array.from(typeMap.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      featuredProducts: normalizedFeaturedProducts,
      sections: Array.from(sectionsMap.values()).slice(0, SECTION_LIMIT),
    };
  }

  /**
   * Busca paginada do marketplace a partir de uma intenção já interpretada.
   *
   * Os tipos públicos escolhidos pela IA entram como termos adicionais (as
   * keywords que definem cada tipo) em vez de virarem um filtro pós-consulta:
   * o tipo é inferido em memória, então filtrar por ele depois quebraria a
   * paginação. Assim tudo continua resolvido em SQL.
   */
  async searchPublic(params: {
    terms: string[];
    productTypeIds?: string[];
    maxPrice?: number | null;
    city?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const pageSize = Math.min(48, Math.max(1, Math.trunc(params.pageSize ?? 24)));
    const city = params.city?.trim();

    const typeKeywords = (params.productTypeIds ?? []).flatMap(
      (id) => PUBLIC_PRODUCT_TYPES.find((type) => type.id === id)?.keywords ?? [],
    );
    const terms = Array.from(new Set([...params.terms, ...typeKeywords].filter((t) => t && t.length >= 3))).slice(0, 40);

    const companyFilter = city ? { isActive: true, city: { contains: city } } : { isActive: true };
    const productWhere: any = {
      isActive: true,
      company: { is: companyFilter },
      category: { is: { isActive: true } },
    };
    if (params.maxPrice && params.maxPrice > 0) productWhere.price = { lte: params.maxPrice };
    if (terms.length) {
      productWhere.OR = terms.flatMap((term) => [
        { name: { contains: term } },
        { description: { contains: term } },
        { category: { is: { name: { contains: term } } } },
      ]);
    }

    const [total, products, companies] = await Promise.all([
      this.db().product.count({ where: productWhere }),
      this.db().product.findMany({
        where: productWhere,
        orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: MARKETPLACE_PRODUCT_INCLUDE,
      }),
      terms.length
        ? this.db().company.findMany({
          where: {
            ...companyFilter,
            OR: [
              ...terms.map((term) => ({ name: { contains: term } })),
              { products: { some: { isActive: true, OR: terms.map((term) => ({ name: { contains: term } })) } } },
            ],
          },
          take: 8,
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            slug: true,
            city: true,
            state: true,
            logoUrl: true,
            deliveryFeeBase: true,
            deliveryFeePerKm: true,
            deliveryRadiusKm: true,
            avgDeliveryTimeMinutes: true,
          },
        })
        : Promise.resolve([]),
    ]);

    return {
      products: {
        items: products.map(normalizeMarketplaceProduct),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      companies: companies.map((company: any) => ({
        ...company,
        deliveryFeeBase: Number(company.deliveryFeeBase),
        deliveryFeePerKm: Number(company.deliveryFeePerKm),
      })),
    };
  }
}

function normalizeMarketplaceProduct(product: any) {
  const publicType = inferPublicProductType(product);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    imageUrl: product.imageUrl,
    isFeatured: product.isFeatured,
    category: {
      id: product.category.id,
      name: product.category.name,
      description: product.category.description,
    },
    publicType,
    company: {
      id: product.company.id,
      name: product.company.name,
      slug: product.company.slug,
      city: product.company.city,
      state: product.company.state,
      logoUrl: product.company.logoUrl,
      deliveryFeeBase: Number(product.company.deliveryFeeBase),
      avgDeliveryTimeMinutes: product.company.avgDeliveryTimeMinutes,
    },
  };
}
