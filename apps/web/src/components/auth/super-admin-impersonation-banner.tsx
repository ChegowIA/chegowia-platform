"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";

/** Mostra inequivocamente que a tela é uma visão de suporte, não a conta do cliente. */
export function SuperAdminImpersonationBanner() {
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const router = useRouter();
  const queryClient = useQueryClient();

  const access = user?.impersonation;
  const isSupportSession = Boolean(
    access?.supportAccess
      && access.companyId
      && user?.actorRole === Role.SUPER_ADMIN
      && user.role === Role.ADMIN,
  );

  const leave = useMutation({
    mutationFn: async (destination: string) => {
      const { data } = await api.post("/auth/context", {
        companyId: null,
        role: Role.SUPER_ADMIN,
      });
      return { ...data, destination };
    },
    onSuccess: ({ accessToken, user: platformUser, destination }) => {
      // Consultas de uma empresa nunca podem sobreviver na memória ao voltar
      // para a plataforma ou abrir outra empresa.
      queryClient.clear();
      setSession(accessToken, platformUser);
      router.replace(destination);
    },
  });

  if (!isSupportSession) return null;

  return (
    <section
      role="status"
      className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-700/70 dark:bg-amber-950/35 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-xs font-black uppercase tracking-[0.15em] text-amber-800 dark:text-amber-300">Modo suporte · super administrador</p>
        <p className="mt-1 text-sm font-bold">Você está visualizando {access?.companyName || "esta empresa"} como administrador.</p>
        <p className="mt-1 text-xs leading-5 text-amber-800/90 dark:text-amber-200/80">Este acesso é registrado, tem duração limitada e não altera o usuário da empresa.</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          isLoading={leave.isPending}
          onClick={() => leave.mutate("/super-admin/empresas")}
        >
          Trocar empresa
        </Button>
        <Button
          type="button"
          size="sm"
          isLoading={leave.isPending}
          onClick={() => leave.mutate("/super-admin/dashboard")}
        >
          Voltar à plataforma
        </Button>
      </div>
      {leave.error && <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-300">{apiErrorMessage(leave.error)}</p>}
    </section>
  );
}
