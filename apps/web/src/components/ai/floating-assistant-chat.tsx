"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";

export function FloatingAssistantChat({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

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
          "fixed bottom-5 right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-brand-600 text-white shadow-2xl",
          "transition-all duration-300 ease-out hover:scale-105 hover:bg-brand-700 active:scale-95",
          open && "pointer-events-none translate-y-20 opacity-0",
        )}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>

      <div
        className={clsx(
          "fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300 ease-out",
          "sm:inset-auto sm:bottom-5 sm:right-5 sm:top-5 sm:w-[560px] sm:max-w-[calc(100vw-2.5rem)] sm:rounded-lg sm:border sm:border-slate-200",
          open ? "pointer-events-auto translate-y-0 opacity-100 sm:translate-x-0" : "pointer-events-none translate-y-6 opacity-0 sm:translate-x-8 sm:translate-y-0",
        )}
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Assistente</p>
            <h2 className="mt-0.5 line-clamp-1 text-lg font-black text-slate-950">{title}</h2>
            {subtitle && <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Fechar assistente"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
