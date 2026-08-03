import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Mantenha em sincronia com o script anti-FOUC de app/layout.tsx. */
export const THEME_STORAGE_KEY = "chegowia-theme";

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  hasHydrated: boolean;
  setPreference: (preference: ThemePreference) => void;
  setResolved: (resolved: ResolvedTheme) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

/**
 * `preference` é a escolha explícita da pessoa e é o único campo persistido.
 * `resolved` é o tema em vigor depois de aplicar `prefers-color-scheme` e vive
 * só em memória — serve para a interface saber qual ícone mostrar.
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "system",
      resolved: "light",
      hasHydrated: false,
      setPreference: (preference) => set({ preference }),
      setResolved: (resolved) => set({ resolved }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: THEME_STORAGE_KEY,
      partialize: (state) => ({ preference: state.preference }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * O Tailwind está em `darkMode: "class"`, então a classe `dark` no <html> é a
 * chave de tudo. `color-scheme` acompanha para que scrollbars, controles
 * nativos e autofill do navegador sigam o tema.
 */
export function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}
