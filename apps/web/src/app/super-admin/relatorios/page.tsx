"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { GrowthPoint, TopCompany } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/input";
import { Table } from "@/components/ui/table";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function GlobalReportsPage() {
  const defaultTo = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d;
  }, []);

  const [from, setFrom] = useState(isoDate(defaultFrom));
  const [to, setTo] = useState(isoDate(defaultTo));

  const { data: topCompanies, isLoading: loadingTop } = useQuery({
    queryKey: ["global-report-top-companies"],
    queryFn: async () => {
      const { data } = await api.get<TopCompany[]>("/reports/global/top-companies");
      return data;
    },
  });

  const { data: growth, isLoading: loadingGrowth } = useQuery({
    queryKey: ["global-report-growth", from, to],
    queryFn: async () => {
      const { data } = await api.get<GrowthPoint[]>("/reports/global/growth", { params: { from, to } });
      return data;
    },
  });

  const totals = useMemo(() => {
    if (!growth) return { orders: 0, revenue: 0 };
    return growth.reduce(
      (acc, item) => ({ orders: acc.orders + item.orders, revenue: acc.revenue + item.revenue }),
      { orders: 0, revenue: 0 },
    );
  }, [growth]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Relatórios globais</h1>

      <Card>
        <CardHeader>
          <CardTitle>Ranking de empresas por pedidos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingTop ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
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
                { header: "Slug", render: (row: TopCompany) => row.company?.slug ?? "-" },
                { header: "Pedidos", render: (row: TopCompany) => row.ordersCount },
                { header: "Faturamento", render: (row: TopCompany) => formatCurrency(row.revenue) },
              ]}
              rows={topCompanies ?? []}
              rowKey={(row) => row.company?.id ?? `sem-empresa-${row.ordersCount}-${row.revenue}`}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Crescimento por período</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-md">
            <FormField label="De">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormField>
            <FormField label="Até">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </FormField>
          </div>

          <div className="mb-4 flex gap-6 text-sm text-slate-600 dark:text-slate-300">
            <p>
              Total de pedidos: <span className="font-semibold text-slate-900 dark:text-slate-100">{totals.orders}</span>
            </p>
            <p>
              Faturamento total:{" "}
              <span className="font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(totals.revenue)}</span>
            </p>
          </div>

          {loadingGrowth ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
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
