import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Role } from "@chegowia/shared";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId: string | null;
  avatarUrl?: string | null;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  hasHydrated: boolean;
  isSessionLoading: boolean;
  setSession: (accessToken: string, user: AuthUser) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setSessionLoading: (isSessionLoading: boolean) => void;
  clear: () => void;
}

/**
 * Access token fica em localStorage (via persist) só para sobreviver a um refresh
 * de página sem precisar de novo login — ele expira em 15min e o refresh token
 * (httpOnly cookie, nunca acessível via JS) é quem garante a renovação segura.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      hasHydrated: false,
      isSessionLoading: true,
      setSession: (accessToken, user) => set({ accessToken, user }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setSessionLoading: (isSessionLoading) => set({ isSessionLoading }),
      clear: () => set({ accessToken: null, user: null }),
    }),
    {
      name: "chegowia-auth",
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
