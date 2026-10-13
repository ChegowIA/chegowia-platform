/** Cardápio complementar da operação demo. As imagens são servidas pelo site. */
const DEMO_PRODUCTS = [
  {
    category: "Pizzas",
    name: "Pizza Margherita",
    description: "Molho de tomate, mussarela, manjericão fresco e azeite.",
    price: 42.9,
    imageUrl: "/assets/demo/pizza-margherita.webp",
    isFeatured: true,
  },
  {
    category: "Pizzas",
    name: "Pizza Calabresa Artesanal",
    description: "Calabresa fatiada, cebola roxa, mussarela e orégano.",
    price: 46.9,
    imageUrl: "/assets/demo/pizza-calabresa-artesanal.webp",
    isFeatured: false,
  },
  {
    category: "Pizzas",
    name: "Pizza Quatro Queijos",
    description: "Mussarela, provolone, gorgonzola e parmesão gratinados.",
    price: 52.9,
    imageUrl: "/assets/demo/pizza-quatro-queijos.webp",
    isFeatured: false,
  },
  {
    category: "Pizzas",
    name: "Pizza Vegetariana",
    description: "Abobrinha, pimentões, cogumelos, tomate-cereja e manjericão.",
    price: 47.9,
    imageUrl: "/assets/demo/pizza-vegetariana.webp",
    isFeatured: false,
  },
  {
    category: "Entradas",
    name: "Pão de Alho Gratinado",
    description: "Pães dourados com creme de alho, mussarela e ervas.",
    price: 18.9,
    imageUrl: "/assets/demo/pao-de-alho-gratinado.webp",
    isFeatured: false,
  },
  {
    category: "Entradas",
    name: "Bruschetta de Tomate",
    description: "Torradas artesanais com tomate fresco, manjericão e azeite.",
    price: 22.9,
    imageUrl: "/assets/demo/bruschetta-de-tomate.webp",
    isFeatured: false,
  },
  {
    category: "Bebidas",
    name: "Limonada da Casa",
    description: "Limonada fresca com gelo e hortelã, 400 ml.",
    price: 11.9,
    imageUrl: "/assets/demo/limonada-da-casa.webp",
    isFeatured: false,
  },
  {
    category: "Bebidas",
    name: "Suco Natural de Laranja",
    description: "Laranja espremida na hora, 400 ml.",
    price: 13.9,
    imageUrl: "/assets/demo/suco-natural-de-laranja.webp",
    isFeatured: false,
  },
  {
    category: "Sobremesas",
    name: "Brownie com Sorvete",
    description: "Brownie de chocolate quente com sorvete de baunilha.",
    price: 24.9,
    imageUrl: "/assets/demo/brownie-com-sorvete.webp",
    isFeatured: false,
  },
  {
    category: "Sobremesas",
    name: "Pudim de Leite",
    description: "Pudim cremoso de leite condensado com calda de caramelo.",
    price: 15.9,
    imageUrl: "/assets/demo/pudim-de-leite.webp",
    isFeatured: false,
  },
];

const CATEGORIES = {
  Pizzas: { description: "Pizzas com tamanho e sabores configuráveis.", position: 1 },
  Bebidas: { description: "Bebidas para acompanhar.", position: 2 },
  Entradas: { description: "Para começar bem a refeição.", position: 3 },
  Sobremesas: { description: "Um final doce para o pedido.", position: 4 },
};

async function upsertDemoProducts(tx, companyId) {
  const categories = new Map();
  for (const [name, category] of Object.entries(CATEGORIES)) {
    const existing = await tx.category.findFirst({ where: { companyId, name } });
    const saved = existing || await tx.category.create({
      data: { companyId, name, ...category, isActive: true },
    });
    categories.set(name, saved.id);
  }

  for (const product of DEMO_PRODUCTS) {
    const { category, ...details } = product;
    const categoryId = categories.get(category);
    const existing = await tx.product.findFirst({ where: { companyId, name: details.name } });
    const data = { categoryId, ...details, isActive: true };
    if (existing) {
      await tx.product.update({ where: { id: existing.id }, data });
    } else {
      await tx.product.create({ data: { companyId, ...data } });
    }
  }
  return DEMO_PRODUCTS.length;
}

module.exports = { DEMO_PRODUCTS, upsertDemoProducts };
