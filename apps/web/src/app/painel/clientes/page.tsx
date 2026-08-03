"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { CustomerProfile, Paginated } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table } from "@/components/ui/table";

export default function ClientesPage() {
  const [tab, setTab] = useState<"ativos" | "inativos">("ativos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [inactiveDays, setInactiveDays] = useState(30);
  const pageSize = 20;

  const { data: activeData, isLoading: loadingActive } = useQuery({
    queryKey: ["customers", search, page],
    queryFn: async () => {
      const { data } = await api.get<Paginated<CustomerProfile>>("/customers", {
        params: { page, pageSize, search: search || undefined },
      });
      return data;
    },
    enabled: tab === "ativos",
  });

  const { data: inactiveData, isLoading: loadingInactive } = useQuery({
    queryKey: ["customers-inactive", inactiveDays],
    queryFn: async () => {
      const { data } = await api.get<CustomerProfile[]>("/customers/inactive", { params: { days: inactiveDays } });
      return data;
    },
    enabled: tab === "inativos",
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Clientes</h1>

      <div className="flex gap-2">
        <Button variant={tab === "ativos" ? "primary" : "outline"} size="sm" onClick={() => setTab("ativos")}>
          Todos
        </Button>
        <Button variant={tab === "inativos" ? "primary" : "outline"} size="sm" onClick={() => setTab("inativos")}>
          Inativos
        </Button>
      </div>

      {tab === "ativos" && (
        <>
          <Input
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
          />
          <Card>
            {loadingActive ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
            ) : (
              <Table
                columns={[
                  { header: "Nome", render: (c: CustomerProfile) => c.user.name },
                  { header: "E-mail", render: (c: CustomerProfile) => c.user.email },
                  { header: "Total de pedidos", render: (c: CustomerProfile) => c.totalOrders },
                  {
                    header: "Último pedido",
                    render: (c: CustomerProfile) => (c.lastOrderAt ? formatDateTime(c.lastOrderAt) : "-"),
                  },
                ]}
                rows={activeData?.items ?? []}
                rowKey={(c) => c.id}
              />
            )}
          </Card>
          {activeData && activeData.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Página {activeData.page} de {activeData.totalPages} · {activeData.total} clientes
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= activeData.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "inativos" && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">Dias sem comprar:</label>
            <Input
              type="number"
              className="max-w-[100px]"
              value={inactiveDays}
              onChange={(e) => setInactiveDays(Number(e.target.value) || 30)}
            />
          </div>
          <Card>
            {loadingInactive ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
            ) : (
              <Table
                columns={[
                  { header: "Nome", render: (c: CustomerProfile) => c.user.name },
                  { header: "E-mail", render: (c: CustomerProfile) => c.user.email },
                  { header: "Total de pedidos", render: (c: CustomerProfile) => c.totalOrders },
                  {
                    header: "Último pedido",
                    render: (c: CustomerProfile) => (c.lastOrderAt ? formatDateTime(c.lastOrderAt) : "Nunca"),
                  },
                ]}
                rows={inactiveData ?? []}
                rowKey={(c) => c.id}
                emptyMessage="Nenhum cliente inativo nesse período."
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
