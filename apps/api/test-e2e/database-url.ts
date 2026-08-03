/**
 * Deriva a URL do banco de teste a partir da URL de desenvolvimento.
 *
 * Os testes de ponta a ponta truncam tabelas entre os casos. Apontar para o
 * banco de trabalho de alguém seria destruir dados sem aviso, então o nome do
 * schema recebe um sufixo e a suíte recusa rodar se o alvo não terminar nele.
 */
export const TEST_DATABASE_SUFFIX = "_e2e";

export function testDatabaseUrl(baseUrl = process.env.DATABASE_URL) {
  if (!baseUrl) {
    throw new Error("DATABASE_URL não configurada — os testes e2e precisam de um MySQL acessível.");
  }
  const url = new URL(baseUrl);
  const database = url.pathname.replace(/^\//, "");
  if (!database) throw new Error("DATABASE_URL não aponta para um schema.");
  if (database.endsWith(TEST_DATABASE_SUFFIX)) return { url: url.toString(), database };
  url.pathname = `/${database}${TEST_DATABASE_SUFFIX}`;
  return { url: url.toString(), database: `${database}${TEST_DATABASE_SUFFIX}` };
}

export function assertTestDatabase(rawUrl: string) {
  const database = new URL(rawUrl).pathname.replace(/^\//, "");
  if (!database.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Recusando rodar: o banco "${database}" não termina em "${TEST_DATABASE_SUFFIX}". `
      + "Os testes e2e apagam dados e só podem apontar para o schema de teste.",
    );
  }
}
