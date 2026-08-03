#!/usr/bin/env node
/**
 * Impede que superfícies e textos claros voltem a nascer sem par escuro.
 *
 * O bug que motivou isto: `bg-gradient-to-br from-white to-sky-50` define
 * `background-image`, que pinta **por cima** do `background-color`. O `Card`
 * traz `dark:bg-slate-900`, mas o gradiente claro cobria esse fundo — no tema
 * escuro o cartão ficava branco, com o texto branco por cima. Ilegível, e
 * invisível para quem desenvolve no tema claro.
 *
 * A checagem é por atributo de classe: se um bloco define fundo ou texto claro
 * e não define nenhuma variante `dark:` correspondente, é erro. Roda no
 * `npm run verify`, junto do lint.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = "apps/web/src";

/**
 * Parada clara de gradiente sem par escuro.
 *
 * A checagem NÃO exige `bg-gradient-to-*` no mesmo literal, e isso é
 * proposital: os cartões de métrica de Mesas guardavam as paradas num objeto
 * de tons e o `bg-gradient-to-br` na classe do elemento. Como eram literais
 * diferentes, nenhum dos dois disparava sozinho — e o cartão continuou branco
 * no tema escuro depois da varredura que deveria ter pego isso.
 *
 * Classes `from-`/`via-`/`to-` só existem para gradiente, então a presença
 * delas já basta como sinal.
 */
const PARADA_CLARA = /\b(from|via|to)-(white|(?:[a-z]+)-(?:50|100|200))\b/;

/** Texto escuro sobre fundo que muda com o tema precisa de par claro. */
const TEXTO_ESCURO = /\btext-(?:red|rose|emerald|amber|sky|violet|indigo|orange|teal|green|blue|yellow|slate)-(?:700|800|900|950)\b/;

/**
 * Fundo que **não** muda com o tema: branco opaco, ou um tom saturado o
 * bastante para valer nos dois. Texto escuro sobre isso está correto — o par
 * `dark:` só é necessário quando o fundo por baixo muda.
 */
const FUNDO_FIXO = /\bbg-(?:white(?![/-])|black|(?:[a-z]+)-(?:300|400|500|600|700|800|900|950))\b/;

/**
 * Branco translúcido (`bg-white/10`, `bg-white/[.06]`) é véu sobre um fundo
 * escuro, não superfície clara. Sinalizar isso seria ruído puro — são as
 * seções de marketing, escuras por decisão de design nos dois temas.
 */
const VEU_TRANSLUCIDO = /\bbg-white\/(?:\[[^\]]+\]|\d+)/;

const problemas = [];

function arquivos(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(tsx|ts)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

/**
 * Extrai literais de string, que é onde as classes vivem. Analisar o arquivo
 * inteiro juntaria classes de blocos distintos e produziria falso negativo —
 * um `dark:` de outro elemento "cobriria" o bloco com problema.
 */
function literais(conteudo) {
  // Comentários citam classes ao explicar o problema; sem removê-los, esta
  // própria checagem acusaria a documentação de surface.ts.
  const semComentarios = conteudo
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (linha, prefixo) => prefixo + " ".repeat(linha.length - prefixo.length));

  const encontrados = [];
  const padrao = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
  let match;
  while ((match = padrao.exec(semComentarios)) !== null) {
    const valor = match[2];
    // Só interessa o que parece lista de classes utilitárias.
    if (!/\b(bg|text|border|from|to|via)-/.test(valor)) continue;
    const linha = semComentarios.slice(0, match.index).split("\n").length;
    encontrados.push({ valor, linha });
  }
  return encontrados;
}

/**
 * Seções sempre escuras nos dois temas — as páginas públicas de marketing e os
 * cabeçalhos em `bg-slate-950`. Ali um cartão branco é a decisão de design, não
 * um esquecimento, e cobrar `dark:` produziria só ruído.
 *
 * A lista é curta e explícita de propósito: crescer aqui é sinal de que alguém
 * está silenciando um problema real em vez de corrigir.
 */
const SEMPRE_ESCURO = [
  "app/software/page.tsx",
  "app/revenda/page.tsx",
  "app/page.tsx",
  "app/revendedor/dashboard/page.tsx",
];

function ehSecaoSempreEscura(caminho) {
  return SEMPRE_ESCURO.some((trecho) => caminho.replaceAll("\\", "/").includes(trecho));
}

for (const caminho of arquivos(RAIZ)) {
  const conteudo = readFileSync(caminho, "utf8");
  for (const { valor, linha } of literais(conteudo)) {
    const local = `${relative(process.cwd(), caminho)}:${linha}`;

    if (PARADA_CLARA.test(valor) && !/\bdark:(?:[a-z-]+:)*(?:from|via|to)-/.test(valor)) {
      problemas.push(`${local} — gradiente claro sem variante escura: "${valor.trim()}"`);
    }
    if (TEXTO_ESCURO.test(valor) && !/\bdark:(?:[a-z-]+:)*text-/.test(valor) && !FUNDO_FIXO.test(valor)) {
      problemas.push(`${local} — texto escuro sem variante escura: "${valor.trim()}"`);
    }
    if (
      /\bbg-(?:white|slate-50|slate-100)\b/.test(valor)
      && !VEU_TRANSLUCIDO.test(valor)
      // Aceita `dark:bg-` e também variantes encadeadas (`dark:hover:bg-`).
      && !/\bdark:(?:[a-z-]+:)*bg-/.test(valor)
      // `text-white` no mesmo bloco indica contexto escuro por construção.
      && !/\btext-white\b/.test(valor)
      && !ehSecaoSempreEscura(caminho)
    ) {
      problemas.push(`${local} — fundo claro sem variante escura: "${valor.trim()}"`);
    }
  }
}

if (problemas.length) {
  console.error(`\nTema escuro: ${problemas.length} problema(s).\n`);
  for (const problema of problemas) console.error(`  ${problema}`);
  console.error(
    "\nCada bloco que define cor clara precisa definir a escura. Para cartões"
    + " tintados use `toneCard()` de apps/web/src/lib/surface.ts, que já traz as duas.\n",
  );
  process.exit(1);
}

console.log("Tema escuro: nenhum bloco claro sem par escuro.");
