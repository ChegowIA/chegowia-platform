import { PrismaClient, Role } from "@prisma/client";

/**
 * Fixtures escritas com o PrismaClient cru do harness. Como não há contexto de
 * tenant fora de uma requisição, a extensão não injeta `companyId` — cada
 * registro declara o seu, o que também deixa explícito no teste a qual empresa
 * cada coisa pertence.
 */
export interface CompanyFixture {
  id: string;
  slug: string;
  admin: { id: string; email: string; role: Role; companyId: string };
  categoryId: string;
  productId: string;
  productPrice: number;
}

export async function createCompany(
  prisma: PrismaClient,
  seed: string,
  options: { productName?: string; productPrice?: number } = {},
): Promise<CompanyFixture> {
  const price = options.productPrice ?? 30;
  const company = await prisma.company.create({
    data: {
      name: `Loja ${seed}`,
      slug: `loja-${seed}`,
      addressLine: "Av. Afonso Pena, 1000",
      city: "Belo Horizonte",
      state: "MG",
      zipCode: "30130000",
      // Coordenadas fixas em loja e endereço: sem elas o serviço geocodifica
      // por rede, e um teste que depende de API externa é um teste instável.
      latitude: -19.9227,
      longitude: -43.9451,
      locationConfirmedAt: new Date(),
      deliveryFeeBase: 5,
      // Zero por km deixa a taxa determinística mesmo que a rota varie.
      deliveryFeePerKm: 0,
      deliveryRadiusKm: 50,
      isActive: true,
      settings: { create: { plan: "pro" } },
    },
  });

  const admin = await prisma.user.create({
    data: {
      name: `Admin ${seed}`,
      email: `admin-${seed}@e2e.local`,
      passwordHash: "nao-usado-nos-testes",
      role: Role.ADMIN,
      companyId: company.id,
      isActive: true,
      emailVerifiedAt: new Date(),
      employeeProfile: { create: { companyId: company.id, position: "Administrador" } },
    },
  });

  const category = await prisma.category.create({
    data: { companyId: company.id, name: `Categoria ${seed}`, position: 1, isActive: true },
  });

  const product = await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: category.id,
      name: options.productName ?? `Produto ${seed}`,
      price,
      isActive: true,
    },
  });

  return {
    id: company.id,
    slug: company.slug,
    admin: { id: admin.id, email: admin.email, role: admin.role, companyId: company.id },
    categoryId: category.id,
    productId: product.id,
    productPrice: price,
  };
}

export async function createCustomer(prisma: PrismaClient, seed: string) {
  const user = await prisma.user.create({
    data: {
      name: `Cliente ${seed}`,
      email: `cliente-${seed}@e2e.local`,
      passwordHash: "nao-usado-nos-testes",
      role: Role.CLIENTE,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });
  const address = await prisma.address.create({
    data: {
      userId: user.id,
      street: "Rua das Flores",
      number: "100",
      neighborhood: "Centro",
      city: "Belo Horizonte",
      state: "MG",
      zipCode: "30130000",
      latitude: -19.9245,
      longitude: -43.9385,
      locationConfirmedAt: new Date(),
      isDefault: true,
    },
  });
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: null as string | null,
    addressId: address.id,
  };
}
