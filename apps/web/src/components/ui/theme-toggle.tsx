"use client";

import clsx from "clsx";
import { useThemeStore } from "@/lib/theme-store";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

/**
 * Alterna direto entre claro e escuro: um clique, um estado. A preferência
 * inicial é "system" (segue o sistema operacional), mas o primeiro clique já
 * fixa uma escolha explícita — não existe um terceiro estado no ciclo.
 */
export function ThemeToggle({ className, tone = "light" }: { className?: string; tone?: "light" | "onDark" }) {
  const resolved = useThemeStore((state) => state.resolved);
  const hasHydrated = useThemeStore((state) => state.hasHydrated);
  const setPreference = useThemeStore((state) => state.setPreference);

  // No SSR não dá para saber o tema; um placeholder do mesmo tamanho evita
  // deslocamento de layout quando o ícone real aparece.
  if (!hasHydrated) return <span className={clsx("block h-10 w-10 shrink-0 rounded-xl", className)} aria-hidden />;

  const isDark = resolved === "dark";
  const label = isDark ? "Mudar para o tema claro" : "Mudar para o tema escuro";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setPreference(isDark ? "light" : "dark")}
      className={clsx(
        "grid h-10 w-10 shrink-0 place-items-center rounded-xl border shadow-sm transition duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-500/30",
        tone === "onDark"
          ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
          : "border-slate-200 bg-white text-slate-500 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-brand-800 dark:hover:bg-brand-950/40 dark:hover:text-brand-300",
        className,
      )}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
