"use client";

import { useEffect, useId, useState } from "react";
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
  position = "right",
  stacked = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  triggerEyebrow?: string;
  triggerLabel?: string;
  /** Permite um segundo canal global, como o suporte, sem sobrepor o assistente operacional. */
  position?: "left" | "right";
  /** Posiciona este atalho acima de outro balão na mesma lateral. */
  stacked?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
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
        aria-expanded={open}
        aria-controls={panelId}
        // O atalho só abre o canal. O fechamento fica explícito no painel,
        // evitando que um segundo toque (comum no mobile) pareça ignorar a
        // abertura ou feche a conversa imediatamente.
        onClick={() => setOpen(true)}
        className={clsx(
          // O ícone fica dentro de uma margem curta e simétrica. A cápsula
          // mantém o seu contorno contínuo, mas ganha respiro suficiente para
          // a curva esquerda não parecer colada ao selo.
          "group fixed z-[110] flex h-14 max-w-[calc(100vw-1.5rem)] cursor-pointer items-center gap-2 overflow-hidden rounded-full bg-brand-600 p-1.5 text-white shadow-[0_18px_50px_-12px_rgba(234,88,12,.5)]",
          position === "left" ? "left-3 md:left-5" : "right-3 md:right-5",
          "ring-1 ring-brand-700/40 dark:ring-white/15 dark:shadow-[0_18px_50px_-12px_rgba(0,0,0,.8)]",
          stacked
            ? hasMobileDock
              ? "bottom-[calc(9.65rem+env(safe-area-inset-bottom))] md:bottom-[5.5rem]"
              : "bottom-[max(5rem,calc(4.25rem+env(safe-area-inset-bottom)))] md:bottom-[5.5rem]"
            : hasMobileDock
              ? "bottom-[calc(5.4rem+env(safe-area-inset-bottom))] md:bottom-5"
              : "bottom-[max(.75rem,env(safe-area-inset-bottom))] md:bottom-5",
          "transition-all duration-300 ease-out hover:-translate-y-1 hover:bg-brand-700 active:translate-y-0 active:scale-95",
          open && "pointer-events-none translate-y-20 opacity-0",
        )}
      >
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-brand-700 ring-1 ring-black/5 dark:bg-slate-900 dark:text-brand-300 dark:ring-white/10">
          <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-brand-600 bg-emerald-400 transition-colors group-hover:border-brand-700" />
          {open ? <CloseIcon /> : <BrandLogo adaptive variant="mark" className="h-8 w-8" />}
        </span>
        <span className="min-w-0 flex-1 pr-2 text-left">
          <span className="block truncate text-[10px] font-bold uppercase tracking-[0.16em] text-brand-100 group-hover:text-brand-50">{triggerEyebrow}</span>
          <span className="block truncate text-sm font-bold leading-tight">{triggerLabel}</span>
        </span>
      </button>

      <div
        id={panelId}
        className={clsx(
          // A central precisa ficar acima do dock móvel (z-80) e de qualquer
          // shell do painel. Sem isso, o clique abria o chat por trás da
          // interface e dava a impressão de que o botão não fazia nada.
          "fixed inset-0 z-[100] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300 ease-out dark:bg-slate-900",
          "sm:inset-auto sm:bottom-6 sm:h-[min(640px,calc(100vh-3rem))] sm:w-[400px] sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl sm:border sm:border-slate-200/80",
          position === "left" ? "sm:left-6" : "sm:right-6",
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
