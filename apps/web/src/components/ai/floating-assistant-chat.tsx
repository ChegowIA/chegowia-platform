"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";

export function FloatingAssistantChat({
  title,
  subtitle,
  children,
  defaultOpen = false,
  triggerEyebrow = "Posso ajudar?",
  triggerLabel = "Fale com a loja",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  triggerEyebrow?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const pathname = usePathname();
  const hasMobileDock = Boolean(pathname?.startsWith("/painel") || pathname?.startsWith("/super-admin") || pathname?.startsWith("/revendedor"));

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Fechar assistente" : "Abrir assistente"}
        onClick={() => setOpen((current) => !current)}
        className={clsx(
          // No claro, a sombra recorta o balão do fundo. No escuro ela não
          // existe visualmente — `bg-slate-950` sobre página quase preta some
          // pelas bordas. O anel é o que devolve o contorno.
          "group fixed right-3 z-[60] flex h-14 items-center gap-3 rounded-full bg-slate-950 p-1.5 text-white shadow-[0_18px_50px_-12px_rgba(15,23,42,.55)] sm:pr-4 md:bottom-5 md:right-5",
          "dark:ring-1 dark:ring-white/15 dark:shadow-[0_18px_50px_-12px_rgba(0,0,0,.8)]",
          hasMobileDock ? "bottom-[calc(5.4rem+env(safe-area-inset-bottom))]" : "bottom-[max(.75rem,env(safe-area-inset-bottom))]",
          "transition-all duration-300 ease-out hover:-translate-y-1 hover:bg-brand-700 active:translate-y-0 active:scale-95",
          open && "pointer-events-none translate-y-20 opacity-0",
        )}
      >
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-brand-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-brand-300">
          <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400 group-hover:border-brand-700" />
          {open ? <CloseIcon /> : <BrandLogo adaptive variant="mark" className="h-8 w-8" />}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-brand-200 group-hover:text-brand-50">{triggerEyebrow}</span>
          <span className="block text-sm font-bold leading-tight">{triggerLabel}</span>
        </span>
      </button>

      <div
        className={clsx(
          "fixed inset-0 z-50 flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300 ease-out dark:bg-slate-900",
          "sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100vh-3rem))] sm:w-[400px] sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl sm:border sm:border-slate-200/80",
          "dark:sm:border-white/15",
          open ? "pointer-events-auto opacity-100 sm:translate-y-0 sm:scale-100" : "pointer-events-none opacity-0 sm:translate-y-6 sm:scale-95",
        )}
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 bg-slate-950 px-5 py-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white dark:bg-slate-900">
              <BrandLogo adaptive variant="mark" className="h-8 w-8" />
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400" />
            </span>
            <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300">Atendimento online</p>
            <h2 className="mt-0.5 line-clamp-1 text-lg font-black text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 line-clamp-1 text-xs text-slate-300">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar assistente"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
