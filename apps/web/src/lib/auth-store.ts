import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PermissionKey, Role } from "@chegowia/shared";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId: string | null;
  avatarUrl?: string | null;
  /** Usado apenas para adaptar a interface; a API continua sendo a autoridade. */
  permissionKeys: PermissionKey[];
  /** Papel real quando a sessão está visualizando um contexto assumido. */
  actorRole?: Role;
  /** Metadados meramente visuais; a validação da impersonação é sempre da API. */
  impersonation?: {
    companyId: string | null;
    companyName: string | null;
    role: Role;
    supportAccess: boolean;
  };
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
 * O access token existe apenas em memória. Ao recarregar a página, o cookie
 * httpOnly de refresh cria uma sessão curta nova; JavaScript nunca persiste o
 * token de acesso em localStorage.
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
      partialize: (state) => ({
        accessToken: null,
        // Nem os metadados da empresa visitada ficam em localStorage numa
        // sessão de suporte. Ao recarregar, o cookie httpOnly ainda válido
        // recompõe a sessão pelo servidor; sem ele, não sobra contexto local.
        user: state.user?.impersonation?.supportAccess ? null : state.user,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
