"use client";

import Link from "next/link";
import clsx from "clsx";

export interface MobileDockItem {
  href: string;
  label: string;
  badge?: number;
}

export function MobileDock({ items, pathname }: { items: MobileDockItem[]; pathname: string | null }) {
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/70 bg-white/90 dark:border-slate-800/70 dark:bg-slate-950/90 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-16px_45px_-28px_rgba(15,23,42,.6)] backdrop-blur-2xl md:hidden">
      <div className="mx-auto flex max-w-lg snap-x gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const active = pathname === item.href || Boolean(pathname?.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "relative flex min-w-[74px] flex-1 snap-center flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-black transition",
                active ? "bg-slate-950 text-white shadow-lg dark:bg-brand-600" : "text-slate-500 active:bg-brand-50 active:text-brand-700 dark:text-slate-400 dark:active:bg-brand-950/40 dark:active:text-brand-300",
              )}
            >
              <span className={clsx("grid h-7 w-7 place-items-center rounded-xl text-sm", active ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                {dockGlyph(item.label)}
              </span>
              <span className="max-w-[72px] truncate">{shortLabel(item.label)}</span>
              {Boolean(item.badge) && <span className="absolute right-2 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[9px] text-white ring-2 ring-white dark:ring-slate-950">{Math.min(item.badge!, 99)}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function shortLabel(label: string) {
  return label.replace(" e salão", "").replace(" globais", "").replace(" e vendas", "");
}

function dockGlyph(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("dashboard") || normalized.includes("visão")) return "🏠";
  if (normalized.includes("pedido")) return "▤";
  if (normalized.includes("mesa")) return "🍽";
  if (normalized.includes("entrega")) return "➜";
  if (normalized.includes("cliente") || normalized.includes("empresa")) return "●";
  if (normalized.includes("financeiro") || normalized.includes("billing") || normalized.includes("plano")) return "R$";
  if (normalized.includes("relatório")) return "↗";
  if (normalized.includes("aprova")) return "✓";
  if (normalized.includes("config")) return "⚙";
  if (normalized.includes("cardápio")) return "◇";
  if (normalized.includes("funcionário")) return "◆";
  return "•";
}
