"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";

/** Deixa inequívoco que se trata de suporte, não da sessão do revendedor. */
export function SuperAdminResellerImpersonationBanner() {
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const router = useRouter();
  const queryClient = useQueryClient();
  const access = user?.impersonation;
  const isSupportSession = Boolean(
    access?.supportAccess
      && access.kind === "RESELLER"
      && access.resellerId
      && user?.actorRole === Role.SUPER_ADMIN
      && user.role === Role.REVENDEDOR,
  );

  const leave = useMutation({
    mutationFn: async (destination: string) => {
      const { data } = await api.post("/auth/context", {
        companyId: null,
        role: Role.SUPER_ADMIN,
      });
      return { ...data, destination };
    },
    onSuccess: ({ accessToken, user: platformUser, sessionExpiresAt, destination }) => {
      queryClient.clear();
      setSession(accessToken, platformUser, sessionExpiresAt);
      router.replace(destination);
    },
  });

  if (!isSupportSession) return null;

  return (
    <section
      role="status"
      className="mb-5 flex flex-col gap-3 rounded-2xl border border-violet-300 bg-violet-50 p-4 text-violet-950 shadow-sm dark:border-violet-700/70 dark:bg-violet-950/35 dark:text-violet-100 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-xs font-black uppercase tracking-[0.15em] text-violet-800 dark:text-violet-300">Modo suporte · somente leitura</p>
        <p className="mt-1 text-sm font-bold">Você está visualizando a carteira de {access?.resellerName || "este revendedor"}.</p>
        <p className="mt-1 text-xs leading-5 text-violet-800/90 dark:text-violet-200/80">A sessão é registrada e temporária. Vendas, leads, conta de recebimento e saques ficam bloqueados nesta visão.</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          isLoading={leave.isPending}
          onClick={() => leave.mutate("/super-admin/revendedores")}
        >
          Trocar revendedor
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
