import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O acesso ao Prisma nos serviços de mensageria passa por `this.db()`, que
 * devolve o client como `any`. Isso apaga a checagem de tipos justamente onde
 * ela protegeria: um `findUnique` por campo não-único compila normalmente e só
 * falha em produção, quando o webhook chega.
 *
 * Estes testes fixam os índices únicos dos quais aquelas consultas dependem.
 */
describe("invariantes do schema para o Gupshup", () => {
  const schema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

  function fieldLine(model: string, field: string) {
    const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
    return body.split("\n").find((line) => line.trim().startsWith(`${field} `)) ?? "";
  }

  it.each([
    ["MessagingChannel", "gupshupAppName"],
    ["PlatformWhatsAppChannel", "gupshupAppName"],
    ["MessagingChannel", "gupshupAppId"],
    ["PlatformWhatsAppChannel", "gupshupAppId"],
  ])("%s.%s é único, pois o canal é resolvido por ele no callback", (model, field) => {
    expect(fieldLine(model, field)).toContain("@unique");
  });

  it("todo índice único novo tem migration correspondente", () => {
    const migrations = readFileSync(
      join(__dirname, "..", "prisma", "migrations", "20260811210000_unique_platform_gupshup_app_name", "migration.sql"),
      "utf8",
    );
    expect(migrations).toContain("PlatformWhatsAppChannel_gupshupAppName_key");
  });
});
