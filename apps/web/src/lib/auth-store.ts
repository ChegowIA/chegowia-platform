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
    resellerId: string | null;
    resellerName: string | null;
    role: Role;
    supportAccess: boolean;
    kind: "COMPANY" | "RESELLER" | null;
  };
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  /** Limite absoluto enviado pelo servidor após a confirmação do MFA. */
  sessionExpiresAt: string | null;
  hasHydrated: boolean;
  isSessionLoading: boolean;
  setSession: (accessToken: string, user: AuthUser, sessionExpiresAt?: string | Date | null) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setSessionLoading: (isSessionLoading: boolean) => void;
  clear: () => void;
}

function normalizedSessionExpiration(value: string | Date | null | undefined) {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * O access token existe apenas em memória. Ao recarregar a página, o cookie
 * httpOnly de refresh restaura a mesma sessão dentro das 24 horas; JavaScript
 * nunca persiste o token de acesso em localStorage.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      sessionExpiresAt: null,
      hasHydrated: false,
      isSessionLoading: true,
      setSession: (accessToken, user, sessionExpiresAt) => set((state) => ({
        accessToken,
        user,
        // /auth/me atualiza só os dados do perfil; ele não pode estender nem
        // apagar a duração concedida pelo desafio MFA.
        sessionExpiresAt: sessionExpiresAt === undefined
          ? state.sessionExpiresAt
          : normalizedSessionExpiration(sessionExpiresAt),
      })),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setSessionLoading: (isSessionLoading) => set({ isSessionLoading }),
      clear: () => set({ accessToken: null, user: null, sessionExpiresAt: null }),
    }),
    {
      name: "chegowia-auth",
      partialize: (state) => ({
        accessToken: null,
        // Nem os metadados da empresa visitada ficam em localStorage numa
        // sessão de suporte. Ao recarregar, o cookie httpOnly ainda válido
        // recompõe a sessão pelo servidor; sem ele, não sobra contexto local.
        user: state.user?.impersonation?.supportAccess ? null : state.user,
        sessionExpiresAt: state.user?.impersonation?.supportAccess ? null : state.sessionExpiresAt,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
