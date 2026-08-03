"use client";

import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex min-h-screen items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="max-h-[96dvh] w-full max-w-xl overflow-hidden rounded-t-[30px] border border-white/70 bg-white shadow-[0_30px_100px_rgba(2,6,23,.35)] sm:max-h-[94vh] sm:rounded-[28px] dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" />
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
          <div><p className="text-[10px] font-black uppercase tracking-[.16em] text-brand-600 dark:text-brand-400">ChegowIA</p><h2 className="mt-0.5 text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">{title}</h2></div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 transition hover:rotate-90 hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[calc(96dvh-82px)] overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:max-h-[calc(94vh-78px)] sm:px-6 sm:py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
