"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { OrderStatus } from "@chegowia/shared";
import { api } from "@/lib/api-client";
import { Order, Paginated } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";

const STATUS_OPTIONS = Object.values(OrderStatus);

export default function PedidosPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["orders", search, status, page],
    queryFn: async () => {
      const { data } = await api.get<Paginated<Order>>("/orders", {
        params: { page, pageSize, search: search || undefined, status: status || undefined },
      });
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Pedidos</h1>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        >
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>
        ) : (
          <Table
            columns={[
              { header: "Cliente", render: (o: Order) => o.customer?.name ?? "-" },
              { header: "Status", render: (o: Order) => <OrderStatusBadge status={o.status} /> },
              { header: "Total", render: (o: Order) => formatCurrency(Number(o.total)) },
              { header: "Criado em", render: (o: Order) => formatDateTime(o.createdAt) },
              {
                header: "",
                render: (o: Order) => (
                  <Link href={`/painel/pedidos/${o.id}`} className="font-medium text-brand-600 hover:underline">
                    Ver detalhes
                  </Link>
                ),
              },
            ]}
            rows={data?.items ?? []}
            rowKey={(o) => o.id}
          />
        )}
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Página {data.page} de {data.totalPages} · {data.total} pedidos
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
