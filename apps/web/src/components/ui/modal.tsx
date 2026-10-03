"use client";

import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Ações persistentes para formulários longos, sempre visíveis no celular. */
  footer?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex min-h-[100dvh] items-stretch justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:min-h-screen sm:items-center sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden border border-white/70 bg-white shadow-[0_30px_100px_rgba(2,6,23,.35)] sm:h-auto sm:max-h-[94vh] sm:rounded-[28px] dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" />
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
          <div><p className="text-[10px] font-black uppercase tracking-[.16em] text-brand-600 dark:text-brand-400">ChegowIA</p><h2 className="mt-0.5 text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">{title}</h2></div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 transition hover:rotate-90 hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 ${footer ? "sm:max-h-[calc(94vh-152px)]" : "sm:max-h-[calc(94vh-78px)]"}`}>{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] dark:border-slate-800 dark:bg-slate-900 sm:px-6 sm:py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
