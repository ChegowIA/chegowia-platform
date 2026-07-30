/** Remove acentos (marcas de combinação Unicode U+0300–U+036F) após NFD e gera um slug amigável para URL. */
export function slugify(input: string): string {
  let withoutDiacritics = "";
  for (const char of input.normalize("NFD")) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x300 && code <= 0x36f) continue;
    withoutDiacritics += char;
  }

  return withoutDiacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
