"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { disconnectSocket } from "@/lib/socket-client";

export type OwnedCompany = {
  id: string;
  name: string;
  slug: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  isActive: boolean;
  isPublished: boolean;
  isTestOnly?: boolean;
  ownerUserId?: string | null;
  users?: { id: string; email: string; emailVerifiedAt: string | null }[];
  subscription?: { status: string } | null;
};

export function useOwnedCompanies() {
  return useQuery({
    queryKey: ["my-companies"],
    queryFn: async () => (await api.get<{ activeCompanyId: string; companies: OwnedCompany[] }>("/auth/my-companies")).data,
  });
}

export function useSwitchUnit() {
  const setSession = useAuthStore((state) => state.setSession);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ companyId, destination }: { companyId: string; destination?: string }) => ({
      ...(await api.post("/auth/my-companies/switch", { companyId })).data,
      destination,
    }),
    onSuccess: (result) => {
      disconnectSocket();
      queryClient.clear();
      setSession(result.accessToken, result.user, result.sessionExpiresAt);
      // Reinicia páginas e salas de eventos com o tenant novo. O cookie de
      // refresh já foi trocado pela API; nenhum cache da unidade anterior fica.
      window.location.assign(result.destination ?? "/painel/dashboard");
    },
  });
}

export function UnitSwitcher() {
  const user = useAuthStore((state) => state.user);
  const { data } = useOwnedCompanies();
  const switchUnit = useSwitchUnit();
  const companies = data?.companies ?? [];
  if (companies.length < 2) return null;
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400">Unidade ativa</span>
      <select
        aria-label="Selecionar unidade ativa"
        value={user?.companyId ?? ""}
        disabled={switchUnit.isPending}
        onChange={(event) => switchUnit.mutate({ companyId: event.target.value })}
        className="max-w-[145px] rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-bold text-slate-900 outline-none focus:border-brand-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white md:max-w-full"
      >
        {companies.map((company) => <option key={company.id} value={company.id} disabled={!company.isActive}>{company.name}</option>)}
      </select>
      {switchUnit.isError && <span className="mt-1 block text-xs text-rose-400">Não foi possível trocar de unidade.</span>}
    </label>
  );
}
