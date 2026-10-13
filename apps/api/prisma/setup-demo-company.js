#!/usr/bin/env node
/**
 * Cria uma operação de demonstração completa, isolada e segura para testes.
 *
 * O registro é sempre marcado como `isTestOnly`, portanto não aparece no
 * catálogo público, sitemap ou busca. Ele segue totalmente utilizável pelo
 * painel autenticado: há equipe, motoboy, cardápio com pizza configurável,
 * mesas, caixa e um pedido em rota para testar a operação.
 *
 * Uso local:
 *   npm run demo:setup
 *
 * Uso no Shell do Render (a imagem de produção não tem npm):
 *   DEMO_ADMIN_EMAIL='seu-email+demo@exemplo.com' node apps/api/prisma/setup-demo-company.js --allow-production
 *
 * Opcionalmente, defina uma senha conhecida para todas as contas de teste:
 *   DEMO_PASSWORD='UmaSenhaForte@2026' node apps/api/prisma/setup-demo-company.js --allow-production
 *
 * Em produção, o ADMIN precisa usar um e-mail acessível para concluir o MFA.
 * A execução é idempotente. Rodá-la novamente restaura os dados-base e troca
 * a senha das contas demo; nunca toma uma conta que pertença a outra empresa.
 */
require("dotenv").config({ quiet: true });

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const { randomBytes } = require("node:crypto");
const { upsertDemoProducts } = require("./demo-catalog");

const prisma = new PrismaClient();

const DEMO_SLUG = "operacao-demo-chegowia";
const DEMO_NAME = "Pizzaria Exemplo ChegowIA";
const DEMO_EMAIL_DOMAIN = "demo.chegowia.invalid";
const DEMO_MARKER = "[demo-chegowia]";
const ACCESS_END = new Date("2099-12-31T23:59:59.000Z");
const DEMO_ASSETS = {
  logo: "/assets/demo/pizzaria-exemplo-chegowia-logo.webp",
  pizza: "/assets/demo/pizza-especial-chegowia.webp",
  soda: "/assets/demo/refrigerante-lata-chegowia.webp",
};

const STAFF = [
  {
    name: "Ana Administradora",
    email: `admin@${DEMO_EMAIL_DOMAIN}`,
    role: "ADMIN",
    position: "Proprietária",
    permissionKeys: [],
  },
  {
    name: "Bruno Atendimento",
    email: `atendente@${DEMO_EMAIL_DOMAIN}`,
    role: "FUNCIONARIO",
    position: "Atendimento e caixa",
    permissionKeys: [
      "caixa.visualizar",
      "caixa.operar",
      "pedidos.visualizar",
      "pedidos.editar",
      "mesas.visualizar",
      "mesas.operar",
      "cardapio.visualizar",
      "entregas.visualizar",
    ],
  },
  {
    name: "Carla Cozinha",
    email: `cozinha@${DEMO_EMAIL_DOMAIN}`,
    role: "COZINHA",
    position: "Pizzaiola",
    permissionKeys: [
      "pedidos.visualizar",
      "pedidos.editar",
      "mesas.visualizar",
      "mesas.operar",
    ],
  },
  {
    name: "Diego Motoboy",
    email: `motoboy@${DEMO_EMAIL_DOMAIN}`,
    role: "MOTOBOY",
    position: "Entregador",
    permissionKeys: ["entregas.visualizar", "entregas.editar"],
  },
  {
    name: "Elisa Garçom",
    email: `garcom@${DEMO_EMAIL_DOMAIN}`,
    role: "GARCOM",
    position: "Atendimento no salão",
    permissionKeys: ["mesas.visualizar", "mesas.operar", "cardapio.visualizar"],
  },
];

const CUSTOMER = {
  name: "Fernanda Cliente",
  email: `cliente@${DEMO_EMAIL_DOMAIN}`,
};

const PERMISSIONS = {
  "pedidos.visualizar": "Ver pedidos",
  "pedidos.editar": "Editar pedidos",
  "mesas.visualizar": "Ver mesas e comandas",
  "mesas.operar": "Abrir mesas e operar comandas",
  "cardapio.visualizar": "Ver cardápio",
  "entregas.visualizar": "Ver entregas",
  "entregas.editar": "Editar entregas",
  "caixa.visualizar": "Ver caixa e turnos",
  "caixa.operar": "Abrir, movimentar e fechar o caixa",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const production = process.env.NODE_ENV === "production";
  if (production && !args["allow-production"]) {
    throw new Error(
      "Produção exige --allow-production. Isso evita criar uma empresa de teste por engano.",
    );
  }
  const adminEmail = resolveDemoAdminEmail(args, production);
  const staffDefinition = buildDemoStaff(adminEmail);

  const plan = await prisma.softwarePlan.findFirst({
    where: { isActive: true },
    orderBy: [{ isFeatured: "desc" }, { monthlyPrice: "asc" }],
  });
  if (!plan) {
    throw new Error(
      "Não há plano ativo neste banco. Inicialize os dados de referência antes de criar a operação demo.",
    );
  }

  const informedPassword = (args.password || process.env.DEMO_PASSWORD || "").trim();
  const password = informedPassword || generatePassword();
  assertStrongPassword(password);
  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { slug: DEMO_SLUG },
      update: {
        name: DEMO_NAME,
        phone: "5562000000000",
        whatsapp: "5562000000000",
        addressLine: "Rua 1, 1",
        city: "Goiânia",
        state: "GO",
        zipCode: "74013010",
        latitude: -16.6784398,
        longitude: -49.2563466,
        deliveryFeeBase: 6,
        deliveryFeePerKm: 1.5,
        deliveryRadiusKm: 12,
        avgDeliveryTimeMinutes: 40,
        logoUrl: DEMO_ASSETS.logo,
        isActive: true,
        isTestOnly: true,
      },
      create: {
        name: DEMO_NAME,
        slug: DEMO_SLUG,
        phone: "5562000000000",
        whatsapp: "5562000000000",
        addressLine: "Rua 1, 1",
        city: "Goiânia",
        state: "GO",
        zipCode: "74013010",
        latitude: -16.6784398,
        longitude: -49.2563466,
        deliveryFeeBase: 6,
        deliveryFeePerKm: 1.5,
        deliveryRadiusKm: 12,
        avgDeliveryTimeMinutes: 40,
        logoUrl: DEMO_ASSETS.logo,
        isActive: true,
        isTestOnly: true,
      },
    });

    const existingSubscription = await tx.clientSubscription.findUnique({
      where: { companyId: company.id },
      include: { commissions: { select: { id: true } } },
    });
    if (
      existingSubscription
      && (
        existingSubscription.commissions.length > 0
        || existingSubscription.stripeCustomerId
        || existingSubscription.stripeSubscriptionId
        || existingSubscription.asaasCustomerId
        || existingSubscription.asaasSubscriptionId
        || existingSubscription.asaasPaymentId
      )
    ) {
      throw new Error(
        "A empresa demo já possui vínculos financeiros. Nenhum dado foi alterado; remova-a pelo script de limpeza ou revise esses vínculos antes de recriá-la.",
      );
    }

    // A guarda de conta exige assinatura ativa em produção. Esta assinatura não
    // tem identificador de provedor nem gera cobrança: ela existe só para que a
    // operação de teste consiga abrir o painel sem usar Asaas ou Stripe.
    await tx.clientSubscription.upsert({
      where: { companyId: company.id },
      update: {
        planId: plan.id,
        monthlyPriceSnapshot: 0,
        status: "ATIVA",
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: ACCESS_END,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: null,
        asaasCustomerId: null,
        asaasSubscriptionId: null,
        asaasPaymentId: null,
        asaasPeriodPaymentId: null,
        canceledAt: null,
      },
      create: {
        companyId: company.id,
        planId: plan.id,
        monthlyPriceSnapshot: 0,
        status: "ATIVA",
        currentPeriodStart: new Date(),
        currentPeriodEnd: ACCESS_END,
      },
    });

    await tx.companySettings.upsert({
      where: { companyId: company.id },
      update: demoCompanySettings(),
      create: { companyId: company.id, ...demoCompanySettings() },
    });

    await ensureDeliveryAreas(tx, company.id);
    await ensurePermissions(tx);

    const staff = [];
    for (const person of staffDefinition) staff.push(await upsertStaff(tx, company.id, person, passwordHash));
    await syncStaffPermissions(tx, staff);

    const customer = await upsertCustomer(tx, company.id, passwordHash);
    const pizzaCategory = await ensureCategory(tx, company.id, {
      name: "Pizzas",
      description: "Pizzas com tamanho e sabores configuráveis.",
      position: 1,
    });
    const drinksCategory = await ensureCategory(tx, company.id, {
      name: "Bebidas",
      description: "Bebidas para acompanhar.",
      position: 2,
    });

    const pizza = await ensureProduct(tx, company.id, pizzaCategory.id, {
      name: "Pizza Especial ChegowIA",
      description: "Exemplo completo de produto configurável: tamanho e até dois sabores, com preço pelo sabor de maior valor.",
      price: 39.9,
      imageUrl: DEMO_ASSETS.pizza,
      isFeatured: true,
    });
    await ensureProduct(tx, company.id, drinksCategory.id, {
      name: "Refrigerante Lata",
      description: "350 ml — item simples para testar adicionais e pedidos mistos.",
      price: 6.5,
      imageUrl: DEMO_ASSETS.soda,
      isFeatured: false,
    });
    await upsertDemoProducts(tx, company.id);

    const sizeGroup = await syncOptionGroup(tx, pizza.id, {
      name: "Tamanho",
      description: "Escolha o tamanho da pizza.",
      selectionType: "SINGLE",
      minSelections: 1,
      maxSelections: 1,
      pricingRule: "SUM",
      position: 1,
      options: [
        { name: "Pequena", priceDelta: -8, position: 1 },
        { name: "Média", priceDelta: 0, position: 2 },
        { name: "Grande", priceDelta: 12, position: 3 },
        { name: "Extra grande", priceDelta: 22, position: 4 },
      ],
    });
    const flavorGroup = await syncOptionGroup(tx, pizza.id, {
      name: "Sabores (até 2 divisões)",
      description: "A pizzaria pode mudar o máximo para 3, 4 ou qualquer quantidade que desejar no painel.",
      selectionType: "MULTIPLE",
      minSelections: 1,
      maxSelections: 2,
      pricingRule: "HIGHEST",
      position: 2,
      options: [
        { name: "Calabresa", priceDelta: 0, position: 1 },
        { name: "Mussarela", priceDelta: 0, position: 2 },
        { name: "Frango com catupiry", priceDelta: 3, position: 3 },
        { name: "Portuguesa", priceDelta: 4, position: 4 },
        { name: "Quatro queijos", priceDelta: 6, position: 5 },
      ],
    });

    await ensureTables(tx, company.id);
    await ensureCashRegister(tx, company.id);
    await ensureOrderInRoute(tx, {
      company,
      customer,
      admin: staff.find((person) => person.role === "ADMIN"),
      motoboy: staff.find((person) => person.role === "MOTOBOY"),
      pizza,
      sizeGroup,
      flavorGroup,
    });

    const orderCount = await tx.order.count({ where: { companyId: company.id, customerId: customer.id } });
    const lastOrder = await tx.order.findFirst({
      where: { companyId: company.id, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    await tx.customerProfile.update({
      where: { userId_companyId: { userId: customer.id, companyId: company.id } },
      data: { totalOrders: orderCount, lastOrderAt: lastOrder?.createdAt ?? null },
    });

    return { company, staff, customer, orderCount, adminEmail };
  }, { timeout: 30_000 });

  console.log("\nOperação demo criada e pronta para testes.\n");
  console.log(`  empresa: ${result.company.name}`);
  console.log(`  slug:    ${result.company.slug}`);
  console.log("  visibilidade pública: ocultada para o público geral (isTestOnly=true)");
  console.log("  assinatura: ativa somente para teste, sem cobrança no Asaas/Stripe\n");
  console.log("Contas para entrar em /acesso:");
  for (const person of result.staff) console.log(`  ${person.role.padEnd(10)} ${person.email}`);
  console.log(`  CLIENTE    ${result.customer.email}`);
  console.log("");
  if (informedPassword) {
    console.log("A senha de todas as contas foi definida por DEMO_PASSWORD/--password.");
  } else {
    console.log(`Senha gerada para todas as contas: ${password}`);
    console.log("Guarde-a agora: ela só aparece nesta execução.");
  }
  if (!isReservedDemoEmail(result.adminEmail)) {
    console.log(`\nO código de segurança do ADMIN será enviado para: ${result.adminEmail}`);
  }
  console.log(`\nTambém há ${result.orderCount} pedido(s) do cliente demo, incluindo um em rota para o motoboy.\n`);
}

function buildDemoStaff(adminEmail) {
  return STAFF.map((person) => (person.role === "ADMIN" ? { ...person, email: adminEmail } : person));
}

function resolveDemoAdminEmail(args, production) {
  const email = String(args["admin-email"] || process.env.DEMO_ADMIN_EMAIL || `admin@${DEMO_EMAIL_DOMAIN}`)
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("DEMO_ADMIN_EMAIL/--admin-email deve ser um e-mail válido.");
  }
  if (production && isReservedDemoEmail(email)) {
    throw new Error(
      "Em produção, defina DEMO_ADMIN_EMAIL (ou --admin-email) com um e-mail acessível e ainda sem conta na ChegowIA. O ADMIN precisa receber o código MFA.",
    );
  }
  return email;
}

function isReservedDemoEmail(email) {
  return email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

function demoCompanySettings() {
  return {
    aiEnabled: true,
    aiKnowledgeBase:
      "Esta é uma operação exclusivamente demonstrativa da ChegowIA. A Pizzaria Exemplo trabalha com pizzas de sabores combináveis, delivery e salão. Não use os dados desta empresa para pedidos reais.",
    whatsappNumber: "5562000000000",
    paymentMethodsEnabled: ["DINHEIRO", "CARTAO_ENTREGA", "PIX_MANUAL"],
    openingHours: {
      segunda: "00:00-00:00",
      terca: "00:00-00:00",
      quarta: "00:00-00:00",
      quinta: "00:00-00:00",
      sexta: "00:00-00:00",
      sabado: "00:00-00:00",
      domingo: "00:00-00:00",
    },
  };
}

async function ensureDeliveryAreas(tx, companyId) {
  const areas = [
    { neighborhood: "Setor Central", city: "Goiânia", deliveryFee: 6 },
    { neighborhood: "Setor Bueno", city: "Goiânia", deliveryFee: 8 },
    { neighborhood: "Setor Oeste", city: "Goiânia", deliveryFee: 7 },
  ];
  for (const area of areas) {
    const existing = await tx.deliveryArea.findFirst({
      where: { companyId, neighborhood: area.neighborhood, city: area.city },
    });
    if (existing) {
      await tx.deliveryArea.update({ where: { id: existing.id }, data: { deliveryFee: area.deliveryFee, isActive: true } });
    } else {
      await tx.deliveryArea.create({ data: { companyId, ...area, isActive: true } });
    }
  }
}

async function ensurePermissions(tx) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await tx.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
}

async function upsertStaff(tx, companyId, person, passwordHash) {
  const existing = await tx.user.findUnique({ where: { email: person.email } });
  if (existing && existing.companyId !== companyId) {
    throw new Error(
      `A conta ${person.email} já existe fora desta operação demo; use um e-mail/alias novo. Nenhum dado foi alterado.`,
    );
  }
  const existingProfile = existing
    ? await tx.employeeProfile.findUnique({ where: { userId: existing.id } })
    : null;
  if (existingProfile && existingProfile.companyId !== companyId) {
    throw new Error(`O perfil de ${person.email} pertence a outra empresa; nenhum dado foi alterado.`);
  }

  const data = {
    name: person.name,
    passwordHash,
    role: person.role,
    companyId,
    isActive: true,
    emailVerifiedAt: new Date(),
    termsAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
  };
  const user = existing
    ? await tx.user.update({ where: { id: existing.id }, data })
    : await tx.user.create({ data: { ...data, email: person.email } });
  const profile = await tx.employeeProfile.upsert({
    where: { userId: user.id },
    update: { companyId, position: person.position },
    create: { userId: user.id, companyId, position: person.position },
  });
  return { ...person, id: user.id, employeeProfileId: profile.id };
}

async function syncStaffPermissions(tx, staff) {
  const keys = [...new Set(staff.flatMap((person) => person.permissionKeys))];
  const permissions = await tx.permission.findMany({ where: { key: { in: keys } } });
  const byKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

  for (const person of staff) {
    await tx.rolePermission.deleteMany({ where: { employeeProfileId: person.employeeProfileId } });
    const rows = person.permissionKeys.map((key) => ({
      employeeProfileId: person.employeeProfileId,
      permissionId: byKey.get(key),
    }));
    if (rows.some((row) => !row.permissionId)) {
      throw new Error(`Não foi possível preparar as permissões de ${person.email}.`);
    }
    if (rows.length) await tx.rolePermission.createMany({ data: rows });
  }
}

async function upsertCustomer(tx, companyId, passwordHash) {
  const existing = await tx.user.findUnique({ where: { email: CUSTOMER.email } });
  if (existing) {
    if (existing.companyId) {
      throw new Error(`A conta ${CUSTOMER.email} está vinculada a uma empresa; nenhum dado foi alterado.`);
    }
    if (await tx.employeeProfile.findUnique({ where: { userId: existing.id } })) {
      throw new Error(`A conta ${CUSTOMER.email} possui perfil de funcionário; nenhum dado foi alterado.`);
    }
    const profiles = await tx.customerProfile.findMany({
      where: { userId: existing.id },
      select: { companyId: true },
    });
    if (!profiles.some((profile) => profile.companyId === companyId) || profiles.some((profile) => profile.companyId !== companyId)) {
      throw new Error(`A conta ${CUSTOMER.email} já existe fora desta operação demo; nenhum dado foi alterado.`);
    }
  }
  const data = {
    name: CUSTOMER.name,
    passwordHash,
    role: "CLIENTE",
    companyId: null,
    isActive: true,
    emailVerifiedAt: new Date(),
    termsAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
  };
  const user = existing
    ? await tx.user.update({ where: { id: existing.id }, data })
    : await tx.user.create({ data: { ...data, email: CUSTOMER.email } });
  await tx.customerProfile.upsert({
    where: { userId_companyId: { userId: user.id, companyId } },
    update: {},
    create: { userId: user.id, companyId },
  });
  const address = await tx.address.findFirst({ where: { userId: user.id, label: "Casa demo" } });
  const addressData = {
    label: "Casa demo",
    street: "Rua 1",
    number: "200",
    complement: "Apartamento 12",
    neighborhood: "Setor Central",
    city: "Goiânia",
    state: "GO",
    zipCode: "74013010",
    reference: "Portaria azul",
    isDefault: true,
  };
  const savedAddress = address
    ? await tx.address.update({ where: { id: address.id }, data: addressData })
    : await tx.address.create({ data: { userId: user.id, ...addressData } });
  return { ...CUSTOMER, id: user.id, address: savedAddress };
}

async function ensureCategory(tx, companyId, category) {
  const existing = await tx.category.findFirst({ where: { companyId, name: category.name } });
  return existing
    ? tx.category.update({ where: { id: existing.id }, data: { ...category, isActive: true } })
    : tx.category.create({ data: { companyId, ...category, isActive: true } });
}

async function ensureProduct(tx, companyId, categoryId, product) {
  const existing = await tx.product.findFirst({ where: { companyId, name: product.name } });
  const data = { categoryId, ...product, isActive: true };
  return existing
    ? tx.product.update({ where: { id: existing.id }, data })
    : tx.product.create({ data: { companyId, ...data } });
}

async function syncOptionGroup(tx, productId, group) {
  const existing = await tx.productOptionGroup.findFirst({ where: { productId, name: group.name } });
  const { options, ...groupData } = group;
  const saved = existing
    ? await tx.productOptionGroup.update({ where: { id: existing.id }, data: { ...groupData, isActive: true } })
    : await tx.productOptionGroup.create({ data: { productId, ...groupData, isActive: true } });
  for (const option of options) {
    const current = await tx.productOption.findFirst({
      where: { productOptionGroupId: saved.id, name: option.name },
    });
    if (current) {
      await tx.productOption.update({ where: { id: current.id }, data: { ...option, isActive: true } });
    } else {
      await tx.productOption.create({ data: { productOptionGroupId: saved.id, ...option, isActive: true } });
    }
  }
  return tx.productOptionGroup.findUniqueOrThrow({
    where: { id: saved.id },
    include: { options: { orderBy: { position: "asc" } } },
  });
}

async function ensureTables(tx, companyId) {
  const tables = [
    { name: "Mesa 01", seats: 2, area: "Salão", sortOrder: 1 },
    { name: "Mesa 02", seats: 4, area: "Salão", sortOrder: 2 },
    { name: "Balcão", seats: 2, area: "Balcão", sortOrder: 3 },
  ];
  for (const table of tables) {
    const existing = await tx.restaurantTable.findUnique({
      where: { companyId_name: { companyId, name: table.name } },
    });
    if (existing) {
      await tx.restaurantTable.update({ where: { id: existing.id }, data: table });
    } else {
      await tx.restaurantTable.create({ data: { companyId, ...table, qrToken: randomBytes(24).toString("base64url") } });
    }
  }
}

async function ensureCashRegister(tx, companyId) {
  const existing = await tx.cashRegister.findUnique({
    where: { companyId_name: { companyId, name: "Caixa principal" } },
  });
  if (existing) return tx.cashRegister.update({ where: { id: existing.id }, data: { isActive: true } });
  return tx.cashRegister.create({ data: { companyId, name: "Caixa principal", isActive: true } });
}

async function ensureOrderInRoute(tx, context) {
  const notes = `${DEMO_MARKER} Pedido em rota para testar entregas.`;
  const existing = await tx.order.findFirst({ where: { companyId: context.company.id, notes } });
  if (existing) return existing;

  const size = findOption(context.sizeGroup, "Média");
  const calabresa = findOption(context.flavorGroup, "Calabresa");
  const frango = findOption(context.flavorGroup, "Frango com catupiry");
  const flavorDelta = Math.max(Number(calabresa.priceDelta), Number(frango.priceDelta));
  const subtotal = 39.9 + Number(size.priceDelta) + flavorDelta;
  const deliveryFee = 6;
  const now = new Date();
  const order = await tx.order.create({
    data: {
      companyId: context.company.id,
      customerId: context.customer.id,
      customerName: context.customer.name,
      customerPhone: "5562000000001",
      source: "SITE",
      addressId: context.customer.address.id,
      deliveryStreet: context.customer.address.street,
      deliveryNumber: context.customer.address.number,
      deliveryComplement: context.customer.address.complement,
      deliveryNeighborhood: context.customer.address.neighborhood,
      deliveryCity: context.customer.address.city,
      deliveryState: context.customer.address.state,
      deliveryReference: context.customer.address.reference,
      subtotal,
      deliveryFee,
      deliveryDistanceKm: 3.2,
      deliveryRouteDurationMinutes: 18,
      discount: 0,
      total: subtotal + deliveryFee,
      paymentMethod: "PIX_MANUAL",
      paymentStatus: "PAGO",
      status: "SAIU_PARA_ENTREGA",
      notes,
      items: {
        create: {
          productId: context.pizza.id,
          productName: context.pizza.name,
          quantity: 1,
          unitPrice: subtotal,
          variationPriceDelta: 0,
          addons: [],
          optionSelections: [
            optionSnapshot(context.sizeGroup, [size]),
            optionSnapshot(context.flavorGroup, [calabresa, frango]),
          ],
          totalPrice: subtotal,
        },
      },
      statusHistory: {
        create: [
          "RECEBIDO",
          "CONFIRMADO",
          "EM_PREPARO",
          "PRONTO",
          "SAIU_PARA_ENTREGA",
        ].map((status, index) => ({
          status,
          changedByUserId: context.admin?.id ?? null,
          createdAt: new Date(now.getTime() - (4 - index) * 5 * 60_000),
        })),
      },
    },
  });
  await tx.delivery.create({
    data: {
      companyId: context.company.id,
      orderId: order.id,
      motoboyId: context.motoboy?.id ?? null,
      status: "EM_ROTA",
      pickedUpAt: new Date(now.getTime() - 10 * 60_000),
      notes: `${DEMO_MARKER} Entrega simulada.`,
      motoboyLatitude: -16.6869,
      motoboyLongitude: -49.2648,
      motoboyLocationUpdatedAt: now,
    },
  });
  await tx.payment.create({
    data: {
      companyId: context.company.id,
      orderId: order.id,
      method: "PIX_MANUAL",
      status: "PAGO",
      amount: subtotal + deliveryFee,
      paidAt: now,
    },
  });
  return order;
}

function findOption(group, name) {
  const option = group.options.find((candidate) => candidate.name === name);
  if (!option) throw new Error(`A opção demo "${name}" não foi criada.`);
  return option;
}

function optionSnapshot(group, options) {
  const deltas = options.map((option) => Number(option.priceDelta));
  const priceDelta = group.pricingRule === "HIGHEST"
    ? Math.max(...deltas)
    : group.pricingRule === "AVERAGE"
      ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
      : deltas.reduce((sum, value) => sum + value, 0);
  return {
    groupId: group.id,
    groupName: group.name,
    pricingRule: group.pricingRule,
    priceDelta,
    options: options.map((option) => ({ id: option.id, name: option.name, priceDelta: Number(option.priceDelta) })),
  };
}

function parseArgs(argv) {
  const result = {};
  for (const item of argv) {
    const flag = /^--([a-zA-Z][a-zA-Z-]*)$/.exec(item);
    if (flag) result[flag[1].toLowerCase()] = true;
    const value = /^--([a-zA-Z][a-zA-Z-]*)=([\s\S]*)$/.exec(item);
    if (value) result[value[1].toLowerCase()] = value[2];
  }
  return result;
}

function assertStrongPassword(password) {
  if (
    password.length < 12
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/[^A-Za-z0-9\s]/.test(password)
  ) {
    throw new Error("A senha deve ter 12+ caracteres, maiúscula, minúscula e símbolo.");
  }
}

function generatePassword() {
  return `${randomBytes(18).toString("base64url")}@1Aa`;
}

main()
  .catch((error) => {
    console.error(`\nFalhou: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
