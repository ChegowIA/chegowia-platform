"use client";

import { useEffect } from "react";
import { applyTheme, resolveTheme, useThemeStore } from "@/lib/theme-store";

/**
 * Aplica o tema depois que o Zustand reidrata. O primeiro paint já vem correto
 * pelo script inline de app/layout.tsx; este provider cuida das trocas em
 * runtime e de acompanhar o sistema operacional enquanto a preferência é
 * "system".
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useThemeStore((state) => state.preference);
  const hasHydrated = useThemeStore((state) => state.hasHydrated);
  const setResolved = useThemeStore((state) => state.setResolved);

  useEffect(() => {
    if (!hasHydrated) return;

    const sync = () => {
      const resolved = resolveTheme(preference);
      applyTheme(resolved);
      setResolved(resolved);
    };

    sync();
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [hasHydrated, preference, setResolved]);

  return <>{children}</>;
}
