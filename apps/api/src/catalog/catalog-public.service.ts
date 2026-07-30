import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";

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

  async getMarketplace(params: { search?: string; city?: string; categoryId?: string }) {
    const search = params.search?.trim();
    const city = params.city?.trim();
    const publicTypeId = params.categoryId?.trim();

    const productWhere: any = {
      isActive: true,
      company: { is: { isActive: true } },
      category: { is: { isActive: true } },
    };

    if (city) productWhere.company = { is: { isActive: true, city: { contains: city } } };
    if (search) {
      productWhere.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { category: { is: { name: { contains: search } } } },
        { company: { is: { name: { contains: search } } } },
      ];
    }

    const [products, featuredProducts] = await Promise.all([
      this.db().product.findMany({
        where: productWhere,
        orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
        include: {
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
        },
      }),
      this.db().product.findMany({
        where: {
          isActive: true,
          isFeatured: true,
          company: { is: city ? { isActive: true, city: { contains: city } } : { isActive: true } },
          category: { is: { isActive: true } },
        },
        take: 10,
        orderBy: { updatedAt: "desc" },
        include: {
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
        },
      }),
    ]);

    const allNormalizedProducts: any[] = products.map(normalizeMarketplaceProduct);
    const normalizedProducts = publicTypeId
      ? allNormalizedProducts.filter((product) => product.publicType.id === publicTypeId)
      : allNormalizedProducts;
    const normalizedFeaturedProducts = featuredProducts
      .map(normalizeMarketplaceProduct)
      .filter((product: any) => !publicTypeId || product.publicType.id === publicTypeId);
    const typeMap = new Map<
      string,
      { id: string; name: string; description: string; icon: string; sortOrder: number; total: number }
    >();
    for (const product of allNormalizedProducts) {
      const current = typeMap.get(product.publicType.id) ?? {
        id: product.publicType.id,
        name: product.publicType.name,
        description: product.publicType.description,
        icon: product.publicType.icon,
        sortOrder: product.publicType.sortOrder,
        total: 0,
      };
      current.total += 1;
      typeMap.set(product.publicType.id, current);
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
      if (section.products.length < 8) section.products.push(product);
      sectionsMap.set(key, section);
    }

    return {
      productTypes: Array.from(typeMap.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      featuredProducts: normalizedFeaturedProducts,
      sections: Array.from(sectionsMap.values()).slice(0, 8),
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

interface PublicProductTypeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  keywords: string[];
}

const PUBLIC_PRODUCT_TYPES: PublicProductTypeDefinition[] = [
  {
    id: "hamburgueres-lanches",
    name: "Hambúrgueres e lanches",
    description: "Burgers, sanduíches, hot dogs, wraps e lanches rápidos.",
    icon: "burger",
    sortOrder: 10,
    keywords: [
      "hamburguer",
      "hamburger",
      "hamburgueres",
      "hamburguers",
      "burguer",
      "burger",
      "smash",
      "xsalada",
      "x salada",
      "xbacon",
      "x bacon",
      "sanduiche",
      "sanduiches",
      "sanduba",
      "lanche",
      "lanches",
      "hot dog",
      "cachorro quente",
      "wrap",
      "baguete",
      "beirute",
    ],
  },
  {
    id: "pizzas",
    name: "Pizzas",
    description: "Pizzas tradicionais, brotinhos, calzones e sabores especiais.",
    icon: "pizza",
    sortOrder: 20,
    keywords: ["pizza", "pizzas", "pizzaria", "brotinho", "calzone", "esfiha", "esfirra"],
  },
  {
    id: "marmitas-pratos",
    name: "Marmitas e pratos",
    description: "Marmitas, pratos executivos, comida caseira e refeições completas.",
    icon: "meal",
    sortOrder: 30,
    keywords: [
      "marmita",
      "marmitex",
      "quentinha",
      "prato",
      "pratos",
      "executivo",
      "refeicao",
      "almoco",
      "jantar",
      "caseira",
      "comida",
      "parmegiana",
      "strogonoff",
      "feijoada",
    ],
  },
  {
    id: "japonesa-sushi",
    name: "Japonesa e sushi",
    description: "Sushi, temaki, yakisoba, combinados e comida oriental.",
    icon: "sushi",
    sortOrder: 40,
    keywords: ["sushi", "sashimi", "temaki", "japones", "japonesa", "yakisoba", "oriental", "uramaki", "niguiri", "poke"],
  },
  {
    id: "sorvetes-acai",
    name: "Sorvetes e açaí",
    description: "Açaí, sorvetes, gelatos, milkshakes, picolés e bowls gelados.",
    icon: "ice-cream",
    sortOrder: 50,
    keywords: [
      "acai",
      "açai",
      "açaí",
      "sorvete",
      "sorvetes",
      "gelato",
      "gelatos",
      "ice cream",
      "milkshake",
      "milk shake",
      "picole",
      "picolé",
      "picoles",
      "picolés",
      "frozen",
      "bowl",
      "copo da felicidade",
    ],
  },
  {
    id: "saudaveis",
    name: "Saudáveis",
    description: "Saladas, naturais, vegetarianos, veganos e opções leves.",
    icon: "leaf",
    sortOrder: 60,
    keywords: ["salada", "saladas", "natural", "fit", "fitness", "saudavel", "saudaveis", "vegano", "vegetariano", "low carb", "integral"],
  },
  {
    id: "sobremesas-doces",
    name: "Sobremesas e doces",
    description: "Doces, bolos, brownies, churros e sobremesas.",
    icon: "cake",
    sortOrder: 70,
    keywords: ["sobremesa", "sobremesas", "doce", "doces", "bolo", "bolos", "brownie", "churros", "brigadeiro", "pudim", "cookie", "torta doce"],
  },
  {
    id: "bebidas",
    name: "Bebidas",
    description: "Refrigerantes, sucos, cafés, drinks e bebidas em geral.",
    icon: "drink",
    sortOrder: 80,
    keywords: ["bebida", "bebidas", "refrigerante", "refri", "suco", "sucos", "agua", "água", "cafe", "café", "drink", "drinks", "cerveja"],
  },
  {
    id: "massas",
    name: "Massas",
    description: "Macarrão, lasanha, nhoque, risotos e massas artesanais.",
    icon: "pasta",
    sortOrder: 90,
    keywords: ["massa", "massas", "macarrao", "macarrão", "lasanha", "nhoque", "gnocchi", "risoto", "ravioli", "spaghetti", "espaguete"],
  },
  {
    id: "carnes-grelhados",
    name: "Carnes e grelhados",
    description: "Churrasco, espetinhos, carnes grelhadas e proteínas.",
    icon: "grill",
    sortOrder: 100,
    keywords: ["carne", "carnes", "churrasco", "churras", "espetinho", "grelhado", "grelhados", "frango", "bife", "picanha", "costela"],
  },
  {
    id: "padaria-cafeteria",
    name: "Padaria e cafeteria",
    description: "Pães, salgados, cafés, tortas e itens de padaria.",
    icon: "bakery",
    sortOrder: 110,
    keywords: ["padaria", "paes", "pães", "pao", "pão", "salgado", "salgados", "cafeteria", "croissant", "torta", "tortas"],
  },
  {
    id: "mercado-conveniencia",
    name: "Mercado e conveniência",
    description: "Itens de mercado, conveniência e compras rápidas.",
    icon: "market",
    sortOrder: 120,
    keywords: ["mercado", "conveniencia", "conveniência", "mercearia", "empório", "emporio", "utilidades", "hortifruti"],
  },
  {
    id: "outros",
    name: "Outros produtos",
    description: "Produtos que ainda não se encaixam em um tipo público específico.",
    icon: "spark",
    sortOrder: 999,
    keywords: [],
  },
];

function inferPublicProductType(product: any) {
  const categoryName = product.category?.name ?? "";
  const searchable = normalizeSearchText([categoryName, product.name, product.description].filter(Boolean).join(" "));
  const type =
    PUBLIC_PRODUCT_TYPES.find((candidate) => candidate.keywords.some((keyword) => searchable.includes(normalizeSearchText(keyword)))) ??
    createFallbackType(categoryName);

  return {
    id: type.id,
    name: type.name,
    description: type.description,
    icon: type.icon,
    sortOrder: type.sortOrder,
  };
}

function createFallbackType(categoryName: string): PublicProductTypeDefinition {
  const normalizedName = normalizeDisplayName(categoryName || "Outros produtos");
  if (!normalizedName || normalizedName === "Outros Produtos") return PUBLIC_PRODUCT_TYPES[PUBLIC_PRODUCT_TYPES.length - 1];
  return {
    id: `tipo-${slugifyPublicType(normalizedName)}`,
    name: normalizedName,
    description: "Tipo público criado dinamicamente a partir das categorias cadastradas pelas empresas.",
    icon: "spark",
    sortOrder: 900,
    keywords: [],
  };
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDisplayName(value: string) {
  const clean = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!clean) return "Outros produtos";

  return clean
    .split(" ")
    .map((word, index) => {
      if (index > 0 && ["de", "da", "do", "das", "dos", "e", "para"].includes(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .replace(/\bHamburguer(es)?\b/g, "Hambúrgueres")
    .replace(/\bSanduiche(s)?\b/g, "Sanduíches")
    .replace(/\bAcai\b/g, "Açaí")
    .replace(/\bCafe\b/g, "Café")
    .replace(/\bJapones(a)?\b/g, "Japonesa")
    .replace(/\bSaudavel\b/g, "Saudável");
}

function slugifyPublicType(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "-") || "outros";
}
