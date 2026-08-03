"use client";

import clsx from "clsx";

/**
 * Subabas de uma área do painel.
 *
 * Segue o mesmo desenho dos filtros já usados no sistema — pílula preenchida
 * para a ativa, texto discreto para as demais — em vez de sublinhado. O painel
 * inteiro usa cantos arredondados e preenchimento para indicar seleção; uma
 * aba sublinhada seria o único elemento com outra gramática.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; badge?: number }>;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900/60"
    >
      {items.map((item) => {
        const ativa = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={ativa}
            onClick={() => onChange(item.value)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition",
              ativa
                ? "bg-brand-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={clsx(
                  "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-black",
                  ativa ? "bg-white/25 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
