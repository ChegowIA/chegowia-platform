"use client";

import { useEffect, useState } from "react";
import { subscribeToToasts, toast, ToastItem } from "@/lib/toast";

const ICONS = {
  success: "✓",
  error: "!",
  info: "i",
  warning: "!",
} as const;

const COLORS = {
  success: "border-emerald-200 bg-emerald-50/95 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/95 dark:text-emerald-50",
  error: "border-red-200 bg-red-50/95 text-red-950 dark:border-red-900/70 dark:bg-red-950/95 dark:text-red-50",
  info: "border-sky-200 bg-sky-50/95 text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/95 dark:text-sky-50",
  warning: "border-amber-200 bg-amber-50/95 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/95 dark:text-amber-50",
} as const;

const ICON_COLORS = {
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-sky-600 text-white",
  warning: "bg-amber-500 text-amber-950",
} as const;

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToToasts(setItems), []);

  return (
    <div className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[10050] mx-auto flex w-auto max-w-md flex-col gap-2 sm:left-auto sm:right-5 sm:top-5 sm:mx-0" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <section
          key={item.id}
          role={item.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-3.5 py-3 shadow-[0_18px_45px_-22px_rgba(15,23,42,.65)] backdrop-blur-xl ${COLORS[item.kind]}`}
        >
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm font-black ${ICON_COLORS[item.kind]}`} aria-hidden="true">{ICONS[item.kind]}</span>
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-sm font-extrabold leading-5">{item.title}</p>
            <p className="mt-0.5 text-sm leading-5 opacity-80">{item.message}</p>
          </div>
          <button
            type="button"
            onClick={() => toast.dismiss(item.id)}
            className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-lg font-medium opacity-60 transition hover:bg-black/10 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/30 dark:hover:bg-white/10"
            aria-label={`Fechar notificação: ${item.title}`}
          >
            ×
          </button>
        </section>
      ))}
    </div>
  );
}
