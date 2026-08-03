import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PERMISSION_LABELS } from "@chegowia/shared";

const prisma = new PrismaClient();
// Derivado de @chegowia/shared para não divergir do seed nem do painel.
const permissions = Object.entries(PERMISSION_LABELS);

async function bootstrap() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    throw new Error("SEED_SUPER_ADMIN_EMAIL e SEED_SUPER_ADMIN_PASSWORD são obrigatórios.");
  }
  if (
    password.length < 12
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/[^A-Za-z0-9\s]/.test(password)
  ) {
    throw new Error("A senha inicial deve ter 12+ caracteres, maiúscula, minúscula e símbolo.");
  }

  for (const [key, description] of permissions) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }
  await prisma.softwarePlan.upsert({
    where: { slug: "profissional" },
    update: {},
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== Role.SUPER_ADMIN) {
    throw new Error("O e-mail inicial já pertence a outro tipo de conta.");
  }
  if (!existing) {
    await prisma.user.create({
      data: {
        name: "ChegowIA",
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: Role.SUPER_ADMIN,
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
    });
  }
  console.log("Bootstrap de produção concluído.");
}

bootstrap()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
