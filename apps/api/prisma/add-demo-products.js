#!/usr/bin/env node
/** Acrescenta apenas produtos à empresa demo existente; não altera usuários, endereços ou pedidos. */
require("dotenv").config({ quiet: true });

const { PrismaClient } = require("@prisma/client");
const { upsertDemoProducts } = require("./demo-catalog");

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
    throw new Error("Produção exige --allow-production para atualizar o cardápio demo.");
  }
  const company = await prisma.company.findUnique({
    where: { slug: "operacao-demo-chegowia" },
    select: { id: true, name: true, isTestOnly: true },
  });
  if (!company || !company.isTestOnly) {
    throw new Error("Empresa demo isolada não encontrada. Nenhum dado foi alterado.");
  }
  const count = await prisma.$transaction(
    (tx) => upsertDemoProducts(tx, company.id),
    { timeout: 30_000 },
  );
  console.log(`${count} produtos ilustrados disponíveis na empresa ${company.name}.`);
}

main()
  .catch((error) => {
    console.error(`Falhou: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
