/**
 * Taxonomia pública de produtos e normalização de texto de busca.
 *
 * Extraído de catalog-public.service.ts porque agora é consumido em dois
 * lugares: a montagem do marketplace e a interpretação de busca assistida por
 * IA (ai/search/search-intent.service.ts), que oferece estes tipos ao modelo
 * como vocabulário fechado. Manter uma cópia só evita que as duas buscas
 * divirjam.
 */

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

/** Lista enxuta (sem keywords) para oferecer ao modelo como vocabulário. */
export const PUBLIC_PRODUCT_TYPE_INDEX = PUBLIC_PRODUCT_TYPES.filter((type) => type.keywords.length > 0).map(
  (type) => ({ id: type.id, name: type.name, description: type.description }),
);

export { PUBLIC_PRODUCT_TYPES, inferPublicProductType, normalizeSearchText, slugifyPublicType, normalizeDisplayName };
export type { PublicProductTypeDefinition };
