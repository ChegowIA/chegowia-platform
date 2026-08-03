import { PrismaClient, Role, UsageMetric } from "@prisma/client";
import { PERMISSION_LABELS } from "@chegowia/shared";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

// Fonte única: a lista vivia duplicada aqui e em bootstrap-production.ts, e as
// duas cópias já tinham divergido (as permissões de mesas nunca chegaram lá).
const PERMISSIONS = Object.entries(PERMISSION_LABELS);

async function hash(password: string) {
  return bcrypt.hash(password, 12);
}

async function main() {
  const production = process.env.NODE_ENV === "production";
  const superAdminEmail = process.env.SEED_SUPER_ADMIN_EMAIL
    ?? (production ? "" : "superadmin@chegowia.com");
  const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD
    ?? (production ? "" : "SuperAdmin@123");
  if (!superAdminEmail || !superAdminPassword) {
    throw new Error(
      "Defina SEED_SUPER_ADMIN_EMAIL e SEED_SUPER_ADMIN_PASSWORD para inicializar a produção.",
    );
  }
  if (
    production
    && (
      superAdminPassword.length < 12
      || !/[A-Z]/.test(superAdminPassword)
      || !/[a-z]/.test(superAdminPassword)
      || !/[^A-Za-z0-9\s]/.test(superAdminPassword)
    )
  ) {
    throw new Error("A senha inicial de produção deve ter 12+ caracteres, maiúscula, minúscula e símbolo.");
  }

  console.log("Seeding permissions...");
  for (const [key, description] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }

  console.log("Seeding super admin...");
  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      name: "ChegowIA",
      passwordHash: await hash(superAdminPassword),
      role: Role.SUPER_ADMIN,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      name: "ChegowIA",
      email: superAdminEmail,
      passwordHash: await hash(superAdminPassword),
      role: Role.SUPER_ADMIN,
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
    },
  });

  console.log("Seeding plano inicial...");
  await prisma.softwarePlan.upsert({
    where: { slug: "profissional" },
    update: { monthlyPrice: 159.9 },
    create: {
      name: "ChegowIA Profissional",
      slug: "profissional",
      description: "A operação completa para delivery, salão, equipe, clientes e inteligência artificial.",
      monthlyPrice: 159.9,
      isFeatured: true,
      features: [
        "Pedidos delivery e atendimento no salão",
        "Gestão de mesas, cozinha e entregas em tempo real",
        "Cardápio, clientes, funcionários e relatórios",
        "Assistentes de IA operacionais e de atendimento",
        "Suporte e atualizações contínuas",
      ],
    },
  });

  console.log("Seeding tabela de custos variáveis...");
  // Valores em BRL, sem margem, com referência PTAX de 31/07/2026 (USD 5,0773).
  // A migration correspondente também atualiza instalações já existentes.
  const usageRates: Array<{
    metric: UsageMetric;
    provider: string;
    label: string;
    unitSize: number;
    providerUnitCost: number;
    markupPercent: number;
  }> = [
    { metric: UsageMetric.IA_TOKENS_ENTRADA, provider: "DeepSeek V4 Flash", label: "IA — entrada sem cache (1M tokens)", unitSize: 1_000_000, providerUnitCost: 0.710822, markupPercent: 200 },
    { metric: UsageMetric.IA_TOKENS_ENTRADA_CACHE, provider: "DeepSeek V4 Flash", label: "IA — entrada com cache (1M tokens)", unitSize: 1_000_000, providerUnitCost: 0.014216, markupPercent: 200 },
    { metric: UsageMetric.IA_TOKENS_SAIDA, provider: "DeepSeek V4 Flash", label: "IA — saída (1M tokens)", unitSize: 1_000_000, providerUnitCost: 1.421644, markupPercent: 200 },
    { metric: UsageMetric.WHATSAPP_SERVICO, provider: "Meta WhatsApp Brasil", label: "WhatsApp — mensagem de serviço", unitSize: 1, providerUnitCost: 0, markupPercent: 30 },
    { metric: UsageMetric.WHATSAPP_TEMPLATE_UTILIDADE, provider: "Meta WhatsApp Brasil", label: "WhatsApp — template de utilidade", unitSize: 1, providerUnitCost: 0.035, markupPercent: 30 },
    { metric: UsageMetric.WHATSAPP_TEMPLATE_MARKETING, provider: "Meta WhatsApp Brasil", label: "WhatsApp — template de marketing", unitSize: 1, providerUnitCost: 0.3217, markupPercent: 30 },
    { metric: UsageMetric.WHATSAPP_TEMPLATE_AUTENTICACAO, provider: "Meta WhatsApp Brasil", label: "WhatsApp — template de autenticação", unitSize: 1, providerUnitCost: 0.035, markupPercent: 30 },
  ];
  /**
   * A margem é a receita da plataforma sobre o consumo — sem ela o repasse é
   * puro e IA e WhatsApp viram custo, não produto.
   *
   * IA a 200% porque o custo absoluto é irrisório (uma conversa custa frações
   * de centavo, mesmo triplicada) e a margem precisa absorver oscilação de
   * câmbio e troca de modelo. WhatsApp a 30% porque ali o custo já é
   * relevante: margem alta tornaria disparo em massa proibitivo para o
   * lojista.
   *
   * `update: {}` preserva ajustes feitos em Super admin > Planos e billing —
   * reexecutar o seed não deve desfazer uma decisão de preço.
   */
  for (const rate of usageRates) {
    await prisma.usageRate.upsert({
      where: { metric: rate.metric },
      update: {},
      create: { ...rate, isActive: true },
    });
  }

  if (production && process.env.SEED_DEMO_DATA !== "true") {
    console.log("Seed de produção concluído sem dados demonstrativos.");
    return;
  }

  console.log("Seeding empresa exemplo...");
  const demoDeliveryAreas = [
    { neighborhood: "Centro", city: "São Paulo", deliveryFee: 5.9 },
    { neighborhood: "Bela Vista", city: "São Paulo", deliveryFee: 6.9 },
    { neighborhood: "Vila Mariana", city: "São Paulo", deliveryFee: 7.9 },
    { neighborhood: "Moema", city: "São Paulo", deliveryFee: 8.9 },
  ];
  const company = await prisma.company.upsert({
    where: { slug: "burger-do-thiago" },
    update: {},
    create: {
      name: "Burger do Thiago",
      slug: "burger-do-thiago",
      phone: "5511999990000",
      whatsapp: "5511999990000",
      addressLine: "Avenida Paulista, 900",
      city: "São Paulo",
      state: "SP",
      deliveryFeeBase: 6.9,
      deliveryFeePerKm: 1.5,
      deliveryRadiusKm: 10,
      avgDeliveryTimeMinutes: 35,
      logoUrl: "/assets/demo/burger-do-thiago.webp",
      isActive: true,
      settings: {
        create: {
          aiEnabled: true,
          aiKnowledgeBase:
            "Burger do Thiago é uma hamburgueria artesanal fundada em 2020, conhecida pelo pão brioche e carne 160g smash. Funciona de terça a domingo, das 18h às 23h30. Aceita dinheiro, cartão na entrega e Pix manual.",
          whatsappNumber: "5511999990000",
          paymentMethodsEnabled: ["DINHEIRO", "CARTAO_ENTREGA", "PIX_MANUAL"],
          openingHours: {
            terca: "18:00-23:30",
            quarta: "18:00-23:30",
            quinta: "18:00-23:30",
            sexta: "18:00-00:00",
            sabado: "18:00-00:00",
            domingo: "18:00-23:00",
          },
        },
      },
      deliveryAreas: {
        create: demoDeliveryAreas,
      },
    },
  });
  for (const area of demoDeliveryAreas) {
    const existingArea = await prisma.deliveryArea.findFirst({
      where: {
        companyId: company.id,
        city: area.city,
        neighborhood: area.neighborhood,
      },
    });
    if (existingArea) {
      await prisma.deliveryArea.update({
        where: { id: existingArea.id },
        data: { deliveryFee: area.deliveryFee, isActive: true },
      });
    } else {
      await prisma.deliveryArea.create({
        data: { companyId: company.id, ...area },
      });
    }
  }
  if (company.cnpj) {
    await prisma.identityDocument.upsert({
      where: { value: company.cnpj },
      update: { ownerType: "COMPANY", ownerId: company.id },
      create: { value: company.cnpj, ownerType: "COMPANY", ownerId: company.id },
    });
  }

  console.log("Seeding admin da empresa...");
  const admin = await prisma.user.upsert({
    where: { email: "admin@burgerdothiago.com" },
    update: {},
    create: {
      name: "Thiago Souza",
      email: "admin@burgerdothiago.com",
      passwordHash: await hash("Admin@123"),
      role: Role.ADMIN,
      companyId: company.id,
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      employeeProfile: {
        create: { companyId: company.id, position: "Proprietário" },
      },
    },
  });

  console.log("Seeding categorias e produtos...");
  const categoriaBurgers = await prisma.category.create({
    data: { companyId: company.id, name: "Hambúrgueres", position: 1 },
  });
  const categoriaBebidas = await prisma.category.create({
    data: { companyId: company.id, name: "Bebidas", position: 2 },
  });

  const classico = await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: categoriaBurgers.id,
      name: "Smash Clássico",
      description: "Pão brioche, 160g de carne smash, queijo cheddar, picles e molho da casa.",
      price: 28.9,
      imageUrl: "/assets/demo/smash-classico.webp",
      isFeatured: true,
      variations: {
        create: [
          { name: "Simples", priceDelta: 0 },
          { name: "Duplo", priceDelta: 12 },
        ],
      },
      addons: {
        create: [
          { name: "Bacon", price: 6 },
          { name: "Ovo", price: 4 },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: categoriaBurgers.id,
      name: "Veggie Grelhado",
      description: "Hambúrguer de grão-de-bico e legumes grelhados, pão australiano.",
      price: 26.9,
      imageUrl: "/assets/demo/veggie-grelhado.webp",
    },
  });

  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: categoriaBebidas.id,
      name: "Refrigerante Lata",
      description: "350ml, várias opções de sabor.",
      price: 6.5,
      imageUrl: "/assets/demo/refrigerante-lata.webp",
    },
  });

  console.log("Seeding cliente exemplo...");
  const customer = await prisma.user.upsert({
    where: { email: "cliente@exemplo.com" },
    update: {},
    create: {
      name: "Ana Cliente",
      email: "cliente@exemplo.com",
      passwordHash: await hash("Cliente@123"),
      role: Role.CLIENTE,
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      addresses: {
        create: {
          label: "Casa",
          street: "Av. Paulista",
          number: "1000",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
          isDefault: true,
        },
      },
      customerProfiles: {
        create: { companyId: company.id },
      },
    },
  });

  console.log("Seed concluído:", {
    superAdmin: superAdmin.email,
    admin: admin.email,
    customer: customer.email,
    company: company.slug,
    produtoDestaque: classico.name,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
