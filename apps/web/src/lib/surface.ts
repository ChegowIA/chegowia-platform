/**
 * Superfícies coloridas que funcionam nos dois temas.
 *
 * O bug que isto elimina: `bg-gradient-to-br from-white to-sky-50` define
 * `background-image`, e `background-image` **pinta por cima** do
 * `background-color`. O `Card` traz `dark:bg-slate-900`, mas o gradiente claro
 * cobria esse fundo — o cartão continuava branco no tema escuro, com texto
 * `dark:text-slate-50` branco por cima. Ilegível.
 *
 * Um `dark:` no gradiente resolve, mas resolver caso a caso garante que o
 * próximo cartão colorido volte a nascer errado. Aqui a variante escura vem
 * junto, por construção.
 *
 * O tom escuro segue o que o sistema já usava para blocos tintados
 * (`{cor}-950/30`): escuro o bastante para o texto claro ler, colorido o
 * bastante para o cartão continuar sendo reconhecível pela cor.
 */
export type SurfaceTone =
  | "sky" | "emerald" | "rose" | "amber" | "violet"
  | "indigo" | "orange" | "teal" | "brand" | "accent" | "slate";

interface ToneClasses {
  /** Fundo com gradiente, claro e escuro. */
  surface: string;
  /** Borda no mesmo tom. */
  border: string;
}

const TONES: Record<SurfaceTone, ToneClasses> = {
  sky: {
    surface: "bg-gradient-to-br from-white to-sky-50 dark:from-sky-950/40 dark:to-slate-900",
    border: "border-sky-100 dark:border-sky-900/50",
  },
  emerald: {
    surface: "bg-gradient-to-br from-white to-emerald-50 dark:from-emerald-950/40 dark:to-slate-900",
    border: "border-emerald-100 dark:border-emerald-900/50",
  },
  rose: {
    surface: "bg-gradient-to-br from-white to-rose-50 dark:from-rose-950/40 dark:to-slate-900",
    border: "border-rose-100 dark:border-rose-900/50",
  },
  amber: {
    surface: "bg-gradient-to-br from-white to-amber-50 dark:from-amber-950/40 dark:to-slate-900",
    border: "border-amber-100 dark:border-amber-900/50",
  },
  violet: {
    surface: "bg-gradient-to-br from-white to-violet-50 dark:from-violet-950/40 dark:to-slate-900",
    border: "border-violet-100 dark:border-violet-900/50",
  },
  indigo: {
    surface: "bg-gradient-to-br from-white to-indigo-50 dark:from-indigo-950/40 dark:to-slate-900",
    border: "border-indigo-100 dark:border-indigo-900/50",
  },
  orange: {
    surface: "bg-gradient-to-br from-white to-orange-50 dark:from-orange-950/40 dark:to-slate-900",
    border: "border-orange-100 dark:border-orange-900/50",
  },
  teal: {
    surface: "bg-gradient-to-br from-white to-teal-50 dark:from-teal-950/40 dark:to-slate-900",
    border: "border-teal-100 dark:border-teal-900/50",
  },
  brand: {
    surface: "bg-gradient-to-br from-white to-brand-50 dark:from-brand-950/40 dark:to-slate-900",
    border: "border-brand-100 dark:border-brand-900/50",
  },
  accent: {
    surface: "bg-gradient-to-br from-white to-accent-50 dark:from-accent-950/40 dark:to-slate-900",
    border: "border-accent-100 dark:border-accent-900/50",
  },
  slate: {
    surface: "bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900",
    border: "border-slate-200 dark:border-slate-800",
  },
};

/** Fundo + borda de um cartão tintado. */
export function toneCard(tone: SurfaceTone) {
  return `${TONES[tone].surface} ${TONES[tone].border}`;
}

export function toneSurface(tone: SurfaceTone) {
  return TONES[tone].surface;
}

export function toneBorder(tone: SurfaceTone) {
  return TONES[tone].border;
}

/**
 * Variante em coluna, para o quadro de pedidos. O gradiente é vertical e a
 * versão escura é mais discreta: são sete colunas lado a lado, e sete fundos
 * saturados competiriam com os cartões de pedido que ficam em cima deles.
 */
const COLUMNS: Partial<Record<SurfaceTone, string>> = {
  sky: "bg-gradient-to-b from-sky-100 to-sky-50 dark:from-sky-950/30 dark:to-slate-900",
  indigo: "bg-gradient-to-b from-indigo-100 to-indigo-50 dark:from-indigo-950/30 dark:to-slate-900",
  amber: "bg-gradient-to-b from-amber-100 to-amber-50 dark:from-amber-950/30 dark:to-slate-900",
  violet: "bg-gradient-to-b from-violet-100 to-violet-50 dark:from-violet-950/30 dark:to-slate-900",
  orange: "bg-gradient-to-b from-orange-100 to-orange-50 dark:from-orange-950/30 dark:to-slate-900",
  emerald: "bg-gradient-to-b from-emerald-100 to-emerald-50 dark:from-emerald-950/30 dark:to-slate-900",
  rose: "bg-gradient-to-b from-rose-100 to-rose-50 dark:from-rose-950/30 dark:to-slate-900",
};

export function toneColumn(tone: SurfaceTone) {
  // Escrito por extenso, não montado com template: o Tailwind varre o código
  // procurando nomes de classe literais, então `from-${tone}-100` nunca seria
  // gerado no CSS e a coluna sairia sem fundo nenhum.
  return COLUMNS[tone] ?? COLUMNS.slate ?? "";
}
