#!/usr/bin/env node
/**
 * Recupera exclusivamente a migration 20261003070000 quando ela já estiver
 * marcada como falha pelo Prisma. É chamado pelo entrypoint na inicialização
 * da produção, para que uma falha parcial conhecida não deixe o serviço sem
 * Shell. Não é um reparador genérico de migrations.
 *
 * A operação é idempotente: cada objeto é conferido no INFORMATION_SCHEMA
 * antes de ser criado. Nenhuma tabela de negócio é apagada e Address.zipCode
 * não é alterado, pois dados históricos podem conter CEP com máscara.
 */

const { PrismaClient } = require("@prisma/client");

const MIGRATION_NAME = "20261003070000_add_operational_postal_codes";
const PRODUCTION_FLAG = "--allow-production";
const prisma = new PrismaClient();

function requireProductionFlag() {
  if (!process.argv.includes(PRODUCTION_FLAG)) {
    throw new Error(
      `Recuperação bloqueada: informe ${PRODUCTION_FLAG}. Este script só pode recuperar a migration conhecida.`,
    );
  }
}

async function query(sql, ...params) {
  return prisma.$queryRawUnsafe(sql, ...params);
}

async function execute(sql, ...params) {
  return prisma.$executeRawUnsafe(sql, ...params);
}

async function hasColumn(tableName, columnName) {
  const rows = await query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    tableName,
    columnName,
  );
  return rows.length > 0;
}

async function hasIndex(tableName, indexName) {
  const rows = await query(
    "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    tableName,
    indexName,
  );
  return rows.length > 0;
}

async function hasTable(tableName) {
  const rows = await query(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
    tableName,
  );
  return rows.length > 0;
}

async function ensure(label, exists, create) {
  if (await exists()) {
    console.log(`${label}: já existe.`);
    return;
  }

  try {
    await create();
  } catch (error) {
    // Em um deploy com api e worker, outra instância pode concluir exatamente
    // este DDL entre a consulta acima e sua execução. Só aceitamos o erro se
    // o objeto esperado realmente passou a existir; qualquer outro problema
    // continua interrompendo o boot para não esconder uma inconsistência.
    if (!(await exists())) throw error;
    console.log(`${label}: concluído por outra instância.`);
    return;
  }

  if (!(await exists())) {
    throw new Error(`${label}: o banco não confirmou a criação esperada.`);
  }
  console.log(`${label}: criado.`);
}

async function assertOnlyExpectedFailure() {
  const failed = await query(
    "SELECT migration_name FROM `_prisma_migrations` WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at ASC",
  );

  if (
    failed.length !== 1
    || failed[0].migration_name !== MIGRATION_NAME
  ) {
    const found = failed.map((row) => row.migration_name).join(", ") || "nenhuma";
    throw new Error(
      `Recuperação bloqueada: a única migration falha precisa ser ${MIGRATION_NAME}; encontrada(s): ${found}.`,
    );
  }
}

async function ensureExpectedSchema() {
  await ensure(
    "Company.zipCode",
    () => hasColumn("Company", "zipCode"),
    () => execute("ALTER TABLE `Company` ADD COLUMN `zipCode` VARCHAR(8) NULL"),
  );
  await ensure(
    "ClientApplication.zipCode",
    () => hasColumn("ClientApplication", "zipCode"),
    () => execute("ALTER TABLE `ClientApplication` ADD COLUMN `zipCode` VARCHAR(8) NULL"),
  );

  // É um update estreito para o único slug criado pelo script oficial de demo;
  // se ele não existir, o update é simplesmente um no-op.
  await execute(
    "UPDATE `Company` SET `addressLine` = 'Rua 1, 1', `city` = 'Goiânia', `state` = 'GO', `zipCode` = '74013010', `latitude` = -16.6784398, `longitude` = -49.2563466 WHERE `slug` = 'operacao-demo-chegowia'",
  );

  await ensure(
    "índice Company_zipCode_idx",
    () => hasIndex("Company", "Company_zipCode_idx"),
    () => execute("CREATE INDEX `Company_zipCode_idx` ON `Company`(`zipCode`)"),
  );
  await ensure(
    "índice Address_zipCode_idx",
    () => hasIndex("Address", "Address_zipCode_idx"),
    () => execute("CREATE INDEX `Address_zipCode_idx` ON `Address`(`zipCode`)"),
  );
  await ensure(
    "tabela PostalCodeLocation",
    () => hasTable("PostalCodeLocation"),
    () => execute(
      "CREATE TABLE `PostalCodeLocation` (`zipCode` VARCHAR(8) NOT NULL, `latitude` DECIMAL(10, 7) NOT NULL, `longitude` DECIMAL(10, 7) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`zipCode`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    ),
  );
}

async function main() {
  requireProductionFlag();
  await assertOnlyExpectedFailure();
  console.log(`Recuperando com segurança a migration ${MIGRATION_NAME}...`);
  await ensureExpectedSchema();
  console.log("Schema da migration conhecida foi conferido; o Prisma pode marcá-la como aplicada.");
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
