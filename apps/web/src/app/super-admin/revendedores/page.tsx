"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Paginated } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { SuperAdminResellerAccessButton } from "@/components/auth/super-admin-reseller-access-button";

type ResellerSummary = {
  id: string;
  code: string;
  isActive: boolean;
  approvedAt: string;
  createdAt: string;
  user: { id: string; name: string; email: string; isActive: boolean; createdAt: string };
  _count: { subscriptions: number; commissions: number; prospects: number; leads: number };
};

/** Diretório operacional, separado de candidaturas, para suporte de contas reais. */
export default function SuperAdminResellersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, error, isLoading } = useQuery({
    queryKey: ["super-admin-resellers", search, page],
    queryFn: async () => {
      const { data } = await api.get<Paginated<ResellerSummary>>("/resellers/admin/profiles", {
        params: { search: search || undefined, page, pageSize },
      });
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <header className="rounded-[30px] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">Suporte de parceiros</p>
        <h1 className="mt-2 text-3xl font-black">Revendedores</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Acesse uma carteira real para diagnosticar dados e bugs. Cada abertura gera uma sessão auditada, temporária e somente leitura.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Buscar parceiro</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Nome, e-mail ou código do revendedor..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="max-w-md"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error && <p role="alert" className="px-5 py-4 text-sm text-red-600 dark:text-red-400">{apiErrorMessage(error)}</p>}
          {isLoading ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando revendedores...</p>
          ) : (
            <Table
              columns={[
                {
                  header: "Parceiro",
                  render: (row: ResellerSummary) => (
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">{row.user.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.user.email}</p>
                    </div>
                  ),
                },
                { header: "Código", render: (row: ResellerSummary) => <span className="font-mono text-xs font-bold text-violet-700 dark:text-violet-300">{row.code}</span> },
                {
                  header: "Carteira",
                  render: (row: ResellerSummary) => (
                    <span className="text-sm text-slate-600 dark:text-slate-300">{row._count.subscriptions} cliente(s) · {row._count.leads} lead(s)</span>
                  ),
                },
                {
                  header: "Status",
                  render: (row: ResellerSummary) => {
                    const active = row.isActive && row.user.isActive;
                    return <Badge tone={active ? "success" : "danger"}>{active ? "Ativo" : "Inativo"}</Badge>;
                  },
                },
                {
                  header: "Acesso",
                  render: (row: ResellerSummary) => <SuperAdminResellerAccessButton resellerId={row.id} compact />,
                },
              ]}
              rows={data?.items ?? []}
              rowKey={(row) => row.id}
            />
          )}
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
          <span className="text-sm text-slate-500 dark:text-slate-400">Página {data.page} de {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}
