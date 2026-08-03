#!/usr/bin/env node
/**
 * Bloqueia glifos que dependem de fonte instalada.
 *
 * O que motivou: o cartão de mesa livre usava `⌑` (U+2311, SQUARE LOZENGE).
 * Quase nenhuma fonte de sistema tem esse caractere, então o navegador
 * desenhava o retângulo de "caractere ausente" — o famoso tofu. Na máquina de
 * quem escreveu, com fonte de desenvolvedor instalada, aparecia certinho.
 *
 * A regra separa dois grupos:
 *
 * - **Emoji** (a partir de U+1F300) tem apresentação própria embutida no
 *   sistema operacional. Renderiza em qualquer lugar; liberado.
 * - **Símbolos técnicos** (Miscellaneous Technical, Geometric Shapes,
 *   Dingbats) dependem de a fonte trazer o desenho. Só os comprovadamente
 *   presentes nas famílias comuns ficam na lista de permitidos; o resto é
 *   erro, e a saída sugere emoji ou SVG.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = "apps/web/src";

/**
 * Glifos que as famílias usuais (Segoe UI Symbol, Apple Symbols, DejaVu,
 * Noto) trazem. Ampliar esta lista exige ter conferido — o ganho de um ícone
 * bonito não paga um retângulo vazio na tela de quem opera o caixa.
 */
const PERMITIDOS = new Set([
  "→", "←", "↑", "↓", "↗", "↘", "➜", "↔",
  "✕", "✓", "✔", "✦", "★", "☆",
  "·", "—", "–", "…", "«", "»", "°",
  "▲", "▼", "◀", "▶", "●", "○", "◆", "◇", "△", "▤",
  "⚙", "⚡", "☎", "☰", "◉", "◎", "▦",
  "⠿", // Braille, usado como alça de arrastar — presente em toda fonte moderna.
]);

/** Faixas onde mora o risco: símbolo técnico, forma geométrica, dingbat. */
function ehRisco(codigo) {
  if (codigo >= 0x1f300) return false; // emoji tem apresentação própria
  return (
    (codigo >= 0x2190 && codigo <= 0x21ff) // setas
    || (codigo >= 0x2300 && codigo <= 0x23ff) // Miscellaneous Technical
    || (codigo >= 0x25a0 && codigo <= 0x25ff) // Geometric Shapes
    || (codigo >= 0x2600 && codigo <= 0x27bf) // Misc Symbols + Dingbats
    || (codigo >= 0x2b00 && codigo <= 0x2bff)
  );
}

function arquivos(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(tsx|ts)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const problemas = [];

for (const caminho of arquivos(RAIZ)) {
  // Comentários citam o caractere problemático ao explicar a correção; sem
  // removê-los, a própria documentação do conserto vira erro.
  const conteudo = readFileSync(caminho, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, " "));
  const linhas = conteudo.split("\n");
  linhas.forEach((linha, indice) => {
    const semComentario = linha.replace(/\/\/.*$/, "");
    for (const char of semComentario) {
      const codigo = char.codePointAt(0) ?? 0;
      if (!ehRisco(codigo) || PERMITIDOS.has(char)) continue;
      problemas.push(
        `${relative(process.cwd(), caminho)}:${indice + 1} — "${char}" (U+${codigo.toString(16).toUpperCase().padStart(4, "0")})`,
      );
    }
  });
}

if (problemas.length) {
  console.error(`\nGlifos dependentes de fonte: ${problemas.length} ocorrência(s).\n`);
  for (const problema of [...new Set(problemas)]) console.error(`  ${problema}`);
  console.error(
    "\nEsses caracteres viram retângulo vazio em quem não tem a fonte. Use um emoji"
    + " (apresentação própria) ou um SVG inline. Se souber que o glifo é seguro,"
    + " acrescente-o a PERMITIDOS em scripts/check-glyphs.mjs.\n",
  );
  process.exit(1);
}

console.log("Glifos: nenhum caractere dependente de fonte fora da lista de permitidos.");
