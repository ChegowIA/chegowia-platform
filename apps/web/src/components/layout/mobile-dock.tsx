"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";

export interface MobileDockItem {
  href: string;
  label: string;
  badge?: number;
}

export function MobileDock({ items, pathname }: { items: MobileDockItem[]; pathname: string | null }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const activeItem = items.find((item) => isActiveRoute(pathname, item.href));

  const visibleItems = useMemo(() => {
    if (items.length <= 4) return items;

    const defaultItems = items.slice(0, 3);
    if (!activeItem || defaultItems.some((item) => item.href === activeItem.href)) return defaultItems;

    return [...items.slice(0, 2), activeItem];
  }, [activeItem, items]);

  const overflowItems = items.filter((item) => !visibleItems.some((visibleItem) => visibleItem.href === item.href));
  const hasOverflow = overflowItems.length > 0;

  if (!items.length) return null;

  return (
    <>
      {moreOpen && (
        <button
          type="button"
          aria-label="Fechar menu de navegação"
          className="fixed inset-0 z-[70] bg-slate-950/25 backdrop-blur-[1px] md:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {moreOpen && hasOverflow && (
        <section
          role="dialog"
          aria-label="Mais seções"
          className="fixed inset-x-3 bottom-[calc(5.7rem+env(safe-area-inset-bottom))] z-[71] overflow-hidden rounded-[26px] border border-slate-200/80 bg-white/95 p-2 shadow-[0_24px_70px_-24px_rgba(15,23,42,.65)] backdrop-blur-2xl dark:border-slate-700 dark:bg-slate-900/95 md:hidden"
        >
          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            <div>
              <p className="text-sm font-black text-slate-950 dark:text-slate-100">Mais seções</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Acesse outra área da operação</p>
            </div>
            <button
              type="button"
              aria-label="Fechar mais seções"
              onClick={() => setMoreOpen(false)}
              className="grid h-9 w-9 place-items-center rounded-xl text-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              ×
            </button>
          </div>
          <div className="grid max-h-[min(52dvh,390px)] grid-cols-2 gap-1 overflow-y-auto p-1">
            {overflowItems.map((item) => (
              <DockMenuItem key={item.href} item={item} active={isActiveRoute(pathname, item.href)} onClick={() => setMoreOpen(false)} />
            ))}
          </div>
        </section>
      )}

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-[80] border-t border-white/70 bg-white/90 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-16px_45px_-28px_rgba(15,23,42,.6)] backdrop-blur-2xl dark:border-slate-800/70 dark:bg-slate-950/90 md:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch gap-1">
          {visibleItems.map((item) => (
            <DockItem key={item.href} item={item} active={isActiveRoute(pathname, item.href)} />
          ))}
          {hasOverflow && (
            <button
              type="button"
              aria-label="Abrir mais seções"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((current) => !current)}
              className={clsx(
                "relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-black transition",
                moreOpen
                  ? "bg-slate-950 text-white shadow-lg dark:bg-brand-600"
                  : "text-slate-500 active:bg-brand-50 active:text-brand-700 dark:text-slate-400 dark:active:bg-brand-950/40 dark:active:text-brand-300",
              )}
            >
              <span className={clsx("grid h-7 w-7 place-items-center rounded-xl", moreOpen ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                <MoreGlyph />
              </span>
              <span className="max-w-full truncate">Mais</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

function DockItem({ item, active }: { item: MobileDockItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-black transition",
        active ? "bg-slate-950 text-white shadow-lg dark:bg-brand-600" : "text-slate-500 active:bg-brand-50 active:text-brand-700 dark:text-slate-400 dark:active:bg-brand-950/40 dark:active:text-brand-300",
      )}
    >
      <span className={clsx("grid h-7 w-7 place-items-center rounded-xl text-sm", active ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
        {dockGlyph(item.label)}
      </span>
      <span className="max-w-full truncate">{shortLabel(item.label)}</span>
      {Boolean(item.badge) && <span className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[9px] text-white ring-2 ring-white dark:ring-slate-950">{Math.min(item.badge!, 99)}</span>}
    </Link>
  );
}

function DockMenuItem({ item, active, onClick }: { item: MobileDockItem; active: boolean; onClick: () => void }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={clsx(
        "relative flex min-w-0 items-center gap-2 rounded-2xl px-3 py-3 text-left transition",
        active ? "bg-brand-50 text-brand-800 dark:bg-brand-950/35 dark:text-brand-200" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
      )}
    >
      <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>{dockGlyph(item.label)}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-black">{item.label}</span>
      {Boolean(item.badge) && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">{Math.min(item.badge!, 99)}</span>}
    </Link>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </svg>
  );
}

function isActiveRoute(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
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
