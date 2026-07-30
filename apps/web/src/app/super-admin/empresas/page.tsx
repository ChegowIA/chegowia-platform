"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Company, Paginated } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";

export default function SuperAdminCompaniesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["super-admin-companies", search, page],
    queryFn: async () => {
      const { data } = await api.get<Paginated<Company>>("/companies", {
        params: { search: search || undefined, page, pageSize },
      });
      return data;
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async (company: Company) => {
      const { data } = await api.patch(`/companies/${company.id}/status`, { isActive: !company.isActive });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["super-admin-companies"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Empresas</h1>
        <Link href="/super-admin/empresas/nova">
          <Button>Nova empresa</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buscar</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Buscar por nome, slug ou cidade..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-sm"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error && <p className="px-5 py-4 text-sm text-red-600">{apiErrorMessage(error)}</p>}
          {isLoading ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>
          ) : (
            <Table
              columns={[
                {
                  header: "Nome",
                  render: (row: Company) => (
                    <Link href={`/super-admin/empresas/${row.id}`} className="font-medium text-brand-600 hover:underline">
                      {row.name}
                    </Link>
                  ),
                },
                { header: "Slug", render: (row: Company) => row.slug },
                {
                  header: "Cidade/UF",
                  render: (row: Company) => (row.city ? `${row.city}${row.state ? `/${row.state}` : ""}` : "-"),
                },
                { header: "Pedidos", render: (row: Company) => row._count?.orders ?? 0 },
                { header: "Usuários", render: (row: Company) => row._count?.users ?? 0 },
                {
                  header: "Status",
                  render: (row: Company) => (
                    <Badge tone={row.isActive ? "success" : "danger"}>{row.isActive ? "Ativa" : "Inativa"}</Badge>
                  ),
                },
                {
                  header: "Ações",
                  render: (row: Company) => (
                    <Button
                      size="sm"
                      variant={row.isActive ? "danger" : "outline"}
                      isLoading={toggleStatus.isPending && toggleStatus.variables?.id === row.id}
                      onClick={() => toggleStatus.mutate(row)}
                    >
                      {row.isActive ? "Desativar" : "Ativar"}
                    </Button>
                  ),
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Página {data.page} de {data.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
