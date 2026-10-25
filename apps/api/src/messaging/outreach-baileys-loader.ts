/** A API é CommonJS; Baileys é ESM. Importação nativa e tardia, só no worker. */
export function loadOutreachBaileys(): Promise<typeof import("@whiskeysockets/baileys")> {
  return new Function("return import('@whiskeysockets/baileys')")() as Promise<typeof import("@whiskeysockets/baileys")>;
}
