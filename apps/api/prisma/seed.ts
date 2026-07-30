import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const PERMISSIONS = [
  ["pedidos.visualizar", "Ver pedidos"],
  ["pedidos.editar", "Editar pedidos"],
  ["pedidos.cancelar", "Cancelar pedidos"],
  ["cardapio.visualizar", "Ver cardápio"],
  ["cardapio.editar", "Editar cardápio"],
  ["entregas.visualizar", "Ver entregas"],
  ["entregas.editar", "Editar entregas"],
  ["funcionarios.visualizar", "Ver funcionários"],
  ["funcionarios.editar", "Editar funcionários"],
  ["relatorios.visualizar", "Ver relatórios"],
  ["configuracoes.editar", "Editar configurações"],
] as const;

async function hash(password: string) {
  return bcrypt.hash(password, 10);
}

async function main() {
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
    where: { email: "superadmin@chegowia.com" },
    update: {},
    create: {
      name: "Super Admin",
      email: "superadmin@chegowia.com",
      passwordHash: await hash("SuperAdmin@123"),
      role: Role.SUPER_ADMIN,
    },
  });

  console.log("Seeding empresa exemplo...");
  const company = await prisma.company.upsert({
    where: { slug: "burger-do-thiago" },
    update: {},
    create: {
      name: "Burger do Thiago",
      slug: "burger-do-thiago",
      phone: "5511999990000",
      whatsapp: "5511999990000",
      addressLine: "Rua das Hamburguerias, 123",
      city: "São Paulo",
      state: "SP",
      deliveryFeeBase: 6.9,
      avgDeliveryTimeMinutes: 35,
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
        create: [
          { neighborhood: "Centro", city: "São Paulo", deliveryFee: 5.9 },
          { neighborhood: "Vila Mariana", city: "São Paulo", deliveryFee: 7.9 },
          { neighborhood: "Moema", city: "São Paulo", deliveryFee: 8.9 },
        ],
      },
    },
  });

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
    },
  });

  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: categoriaBebidas.id,
      name: "Refrigerante Lata",
      description: "350ml, várias opções de sabor.",
      price: 6.5,
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
