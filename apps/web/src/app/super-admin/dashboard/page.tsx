"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { GlobalOverview, GrowthPoint, TopCompany } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table } from "@/components/ui/table";

export default function SuperAdminDashboardPage() {
  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["global-overview"],
    queryFn: async () => {
      const { data } = await api.get<GlobalOverview>("/reports/global/overview");
      return data;
    },
  });

  const { data: topCompanies, isLoading: loadingTop } = useQuery({
    queryKey: ["global-top-companies"],
    queryFn: async () => {
      const { data } = await api.get<TopCompany[]>("/reports/global/top-companies");
      return data;
    },
  });

  const { data: growth, isLoading: loadingGrowth } = useQuery({
    queryKey: ["global-growth", "last30"],
    queryFn: async () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 29);
      const { data } = await api.get<GrowthPoint[]>("/reports/global/growth", {
        params: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      });
      return data;
    },
  });

  const cards = [
    { label: "Empresas ativas", value: overview?.activeCompanies },
    { label: "Total de empresas", value: overview?.totalCompanies },
    { label: "Total de pedidos", value: overview?.totalOrders },
    { label: "Faturamento estimado", value: overview ? formatCurrency(overview.estimatedRevenue) : undefined },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Dashboard da plataforma</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent>
              <p className="text-sm text-slate-500 dark:text-slate-400">{card.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {loadingOverview ? "..." : (card.value ?? "-")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empresas com mais pedidos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingTop ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>
          ) : (
            <Table
              columns={[
                {
                  header: "Empresa",
                  render: (row: TopCompany) =>
                    row.company ? (
                      <Link href={`/super-admin/empresas/${row.company.id}`} className="font-medium text-brand-600 hover:underline">
                        {row.company.name}
                      </Link>
                    ) : (
                      "-"
                    ),
                },
                { header: "Pedidos", render: (row: TopCompany) => row.ordersCount },
                { header: "Faturamento", render: (row: TopCompany) => formatCurrency(row.revenue) },
              ]}
              rows={topCompanies ?? []}
              rowKey={(row) => row.company?.id ?? Math.random().toString()}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Crescimento (últimos 30 dias)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingGrowth ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>
          ) : (
            <Table
              columns={[
                { header: "Data", render: (row: GrowthPoint) => new Date(row.date).toLocaleDateString("pt-BR") },
                { header: "Pedidos", render: (row: GrowthPoint) => row.orders },
                { header: "Receita", render: (row: GrowthPoint) => formatCurrency(row.revenue) },
              ]}
              rows={growth ?? []}
              rowKey={(row) => row.date}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
