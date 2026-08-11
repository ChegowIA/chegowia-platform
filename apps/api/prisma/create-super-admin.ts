import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

/**
 * Cria (ou promove) um superadmin pelo shell — feito para rodar no console do
 * Render, onde não há terminal interativo.
 *
 * Diferente do seed, este script não recria permissões nem dados de exemplo:
 * ele mexe em um usuário só. É seguro rodar em produção com a base já populada.
 *
 * Uso:
 *   npm run create:super-admin -- --email=contato@chegowia.com.br --name="ChegowIA"
 *   npm run create:super-admin -- --email=... --password='SenhaForte@2026'
 *
 * Sem --password uma senha forte é sorteada e impressa uma única vez.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = (args.email ?? process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (args.name ?? process.env.SUPER_ADMIN_NAME ?? "ChegowIA").trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Informe um e-mail válido: --email=contato@chegowia.com.br");
  }

  const password = (args.password ?? process.env.SUPER_ADMIN_PASSWORD ?? "").trim() || generatePassword();
  const generated = !args.password && !process.env.SUPER_ADMIN_PASSWORD;
  assertStrongPassword(password);

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    // Promover um usuário existente não pode apagar o histórico dele: só
    // ajustamos papel, senha e os campos que destravam o acesso.
    update: {
      role: Role.SUPER_ADMIN,
      passwordHash,
      isActive: true,
      emailVerifiedAt: new Date(),
      // Superadmin é conta de plataforma: não pertence a nenhuma empresa.
      companyId: null,
    },
    create: {
      name,
      email,
      passwordHash,
      role: Role.SUPER_ADMIN,
      isActive: true,
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
    },
  });

  console.log("");
  console.log(existing ? "Usuário promovido a SUPER_ADMIN." : "SUPER_ADMIN criado.");
  console.log(`  id:    ${user.id}`);
  console.log(`  nome:  ${user.name}`);
  console.log(`  email: ${user.email}`);
  if (generated) {
    console.log("");
    console.log(`  senha: ${password}`);
    console.log("  Esta senha não será exibida de novo. Guarde-a agora e troque após o primeiro acesso.");
  }
  if (existing && existing.role !== Role.SUPER_ADMIN) {
    console.log("");
    console.log(`  Atenção: este usuário era ${existing.role} e foi desvinculado da empresa anterior.`);
  }
  console.log("");
}

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (const item of argv) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(item);
    if (match) result[match[1].toLowerCase()] = match[2];
  }
  return result as { email?: string; name?: string; password?: string };
}

/** Mesma régua do seed de produção, para não abrir uma porta mais fraca aqui. */
function assertStrongPassword(password: string) {
  if (
    password.length < 12
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/[^A-Za-z0-9\s]/.test(password)
  ) {
    throw new Error("A senha deve ter 12+ caracteres, com maiúscula, minúscula e símbolo.");
  }
}

function generatePassword() {
  // base64url não gera símbolo com garantia; o sufixo fixo satisfaz a régua sem
  // reduzir a entropia dos 18 bytes sorteados.
  return `${randomBytes(18).toString("base64url")}@1Aa`;
}

main()
  .catch((error) => {
    console.error("");
    console.error(`Falhou: ${error instanceof Error ? error.message : String(error)}`);
    console.error("");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
