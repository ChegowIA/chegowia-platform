import { execFileSync } from "node:child_process";
import { assertTestDatabase, testDatabaseUrl } from "./database-url";

/**
 * Cria o schema de teste (se não existir) e aplica as migrações antes da suíte.
 *
 * Usa `migrate deploy`, o mesmo comando da produção, para o e2e validar as
 * migrações de verdade — não um `db push` que aceitaria um schema que nunca
 * chegaria a rodar em produção.
 */
export default async function globalSetup() {
  const { url, database } = testDatabaseUrl();
  assertTestDatabase(url);

  const admin = new URL(url);
  admin.pathname = "/";

  const { PrismaClient } = require("@prisma/client");
  const root = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    await root.$executeRawUnsafe(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch (error) {
    // O usuário da aplicação normalmente não pode criar schema — é assim que
    // deve ser. A mensagem entrega o comando exato em vez de deixar o erro cru
    // do MySQL, que não diz o que fazer.
    const user = decodeURIComponent(admin.username);
    throw new Error(
      `Não foi possível criar o schema de teste "${database}": ${(error as Error).message}\n\n`
      + "Rode uma vez, como administrador do MySQL:\n"
      + `  CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`
      + `  GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user}'@'%';\n`
      + "  FLUSH PRIVILEGES;",
    );
  } finally {
    await root.$disconnect();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"], {
    cwd: __dirname + "/..",
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  // Cada worker do Jest lê daqui; o resto da suíte nunca toca no banco de dev.
  process.env.DATABASE_URL = url;
}
