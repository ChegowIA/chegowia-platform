"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PromotionStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import {
  DelayedDeliveryReport,
  MotoboyPerformanceReport,
  OrdersByStatusReport,
  PeakHourReport,
  Promotion,
  RecurringCustomerReport,
  SalesReport,
  TopProductReport,
} from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";

const PROMOTION_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "brand"> = {
  RASCUNHO: "neutral",
  PENDENTE_CONFIRMACAO: "warning",
  ATIVA: "success",
  ENCERRADA: "danger",
};

export default function RelatoriosPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [delayThreshold, setDelayThreshold] = useState(45);

  const { data: sales } = useQuery({
    queryKey: ["report-sales", from, to],
    queryFn: async () => {
      const { data } = await api.get<SalesReport>("/reports/sales", { params: { from: from || undefined, to: to || undefined } });
      return data;
    },
  });

  const { data: ordersByStatus } = useQuery({
    queryKey: ["report-orders-by-status"],
    queryFn: async () => {
      const { data } = await api.get<OrdersByStatusReport[]>("/reports/orders-by-status");
      return data;
    },
  });

  const { data: topProducts } = useQuery({
    queryKey: ["report-top-products", from, to],
    queryFn: async () => {
      const { data } = await api.get<TopProductReport[]>("/reports/top-products", {
        params: { from: from || undefined, to: to || undefined },
      });
      return data;
    },
  });

  const { data: recurringCustomers } = useQuery({
    queryKey: ["report-recurring-customers"],
    queryFn: async () => {
      const { data } = await api.get<RecurringCustomerReport[]>("/reports/recurring-customers");
      return data;
    },
  });

  const { data: delayedDeliveries } = useQuery({
    queryKey: ["report-delayed-deliveries", delayThreshold],
    queryFn: async () => {
      const { data } = await api.get<DelayedDeliveryReport[]>("/reports/delayed-deliveries", {
        params: { thresholdMinutes: delayThreshold },
      });
      return data;
    },
  });

  const { data: motoboyPerformance } = useQuery({
    queryKey: ["report-motoboy-performance"],
    queryFn: async () => {
      const { data } = await api.get<MotoboyPerformanceReport[]>("/reports/motoboy-performance");
      return data;
    },
  });

  const { data: peakHours } = useQuery({
    queryKey: ["report-peak-hours", from, to],
    queryFn: async () => {
      const { data } = await api.get<PeakHourReport[]>("/reports/peak-hours", {
        params: { from: from || undefined, to: to || undefined },
      });
      return data;
    },
  });

  const { data: promotions, isLoading: loadingPromotions } = useQuery({
    queryKey: ["promotions"],
    queryFn: async () => {
      const { data } = await api.get<Promotion[]>("/promotions");
      return data;
    },
  });

  const [promotionModalOpen, setPromotionModalOpen] = useState(false);
  const [promotionForm, setPromotionForm] = useState({
    title: "",
    description: "",
    discountType: "PERCENTUAL",
    discountValue: "",
    startsAt: "",
    endsAt: "",
  });

  const createPromotion = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/promotions", {
        title: promotionForm.title,
        description: promotionForm.description || undefined,
        discountType: promotionForm.discountType,
        discountValue: Number(promotionForm.discountValue),
        startsAt: promotionForm.startsAt ? new Date(promotionForm.startsAt).toISOString() : undefined,
        endsAt: promotionForm.endsAt ? new Date(promotionForm.endsAt).toISOString() : undefined,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setPromotionModalOpen(false);
      setPromotionForm({ title: "", description: "", discountType: "PERCENTUAL", discountValue: "", startsAt: "", endsAt: "" });
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const setPromotionStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PromotionStatus }) => {
      const { data } = await api.patch(`/promotions/${id}/status`, { status });
      return data;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const maxPeak = Math.max(1, ...(peakHours ?? []).map((h) => h.count));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Relatórios</h1>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20">{error}</p>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <FormField label="De">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="Até">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
          <p className="pb-2 text-xs text-slate-500">Filtro aplicado em vendas, top produtos e horários de pico.</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Vendas no período</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{sales ? sales.ordersCount : "..."}</p>
            <p className="text-slate-500">pedidos</p>
            <p>Receita: {sales ? formatCurrency(Number(sales.revenue)) : "..."}</p>
            <p>Ticket médio: {sales ? formatCurrency(Number(sales.averageTicket)) : "..."}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pedidos por status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {ordersByStatus?.map((r) => (
              <div key={r.status} className="flex justify-between">
                <span>{r.status.replaceAll("_", " ")}</span>
                <span className="font-medium">{r.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Horários de pico</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-24 items-end gap-0.5">
              {peakHours?.map((h) => (
                <div
                  key={h.hour}
                  title={`${h.hour}h: ${h.count} pedidos`}
                  className="flex-1 rounded-t bg-brand-500"
                  style={{ height: `${(h.count / maxPeak) * 100}%`, minHeight: h.count > 0 ? "2px" : "0" }}
                />
              ))}
            </div>
            <p className="mt-1 text-center text-xs text-slate-500">0h — 23h</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Produtos mais vendidos</CardTitle>
        </CardHeader>
        <Table
          columns={[
            { header: "Produto", render: (p: TopProductReport) => p.productName },
            { header: "Qtd vendida", render: (p: TopProductReport) => p.quantitySold },
            { header: "Receita", render: (p: TopProductReport) => formatCurrency(Number(p.revenue)) },
          ]}
          rows={topProducts ?? []}
          rowKey={(p) => p.productId}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clientes recorrentes</CardTitle>
        </CardHeader>
        <Table
          columns={[
            { header: "Nome", render: (c: RecurringCustomerReport) => c.user.name },
            { header: "E-mail", render: (c: RecurringCustomerReport) => c.user.email },
            { header: "Total de pedidos", render: (c: RecurringCustomerReport) => c.totalOrders },
            {
              header: "Último pedido",
              render: (c: RecurringCustomerReport) => (c.lastOrderAt ? formatDateTime(c.lastOrderAt) : "-"),
            },
          ]}
          rows={recurringCustomers ?? []}
          rowKey={(c) => c.id}
        />
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Entregas atrasadas</CardTitle>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Limite (min):</label>
            <Input
              type="number"
              className="max-w-[90px]"
              value={delayThreshold}
              onChange={(e) => setDelayThreshold(Number(e.target.value) || 45)}
            />
          </div>
        </CardHeader>
        <Table
          columns={[
            { header: "Bairro", render: (d: DelayedDeliveryReport) => d.order.deliveryNeighborhood },
            { header: "Motoboy", render: (d: DelayedDeliveryReport) => d.motoboy?.name ?? "-" },
            { header: "Status", render: (d: DelayedDeliveryReport) => d.status.replaceAll("_", " ") },
            { header: "Desde", render: (d: DelayedDeliveryReport) => formatDateTime(d.createdAt) },
          ]}
          rows={delayedDeliveries ?? []}
          rowKey={(d) => d.id}
          emptyMessage="Nenhuma entrega atrasada."
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Desempenho dos motoboys</CardTitle>
        </CardHeader>
        <Table
          columns={[
            { header: "Nome", render: (m: MotoboyPerformanceReport) => m.name },
            { header: "Entregas concluídas", render: (m: MotoboyPerformanceReport) => m.deliveriesCompleted },
            { header: "Tempo médio (min)", render: (m: MotoboyPerformanceReport) => m.averageMinutesPerDelivery },
          ]}
          rows={motoboyPerformance ?? []}
          rowKey={(m) => m.motoboyId}
        />
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Promoções e ofertas</CardTitle>
          <Button size="sm" onClick={() => setPromotionModalOpen(true)}>
            Nova promoção
          </Button>
        </CardHeader>
        {loadingPromotions ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>
        ) : (
          <Table
            columns={[
              { header: "Título", render: (p: Promotion) => p.title },
              {
                header: "Desconto",
                render: (p: Promotion) =>
                  p.discountType === "PERCENTUAL" ? `${p.discountValue}%` : formatCurrency(Number(p.discountValue)),
              },
              {
                header: "Status",
                render: (p: Promotion) => <Badge tone={PROMOTION_TONE[p.status] ?? "neutral"}>{p.status.replaceAll("_", " ")}</Badge>,
              },
              { header: "Criada em", render: (p: Promotion) => formatDateTime(p.createdAt) },
              {
                header: "Mudar status",
                render: (p: Promotion) => (
                  <Select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) setPromotionStatus.mutate({ id: p.id, status: e.target.value as PromotionStatus });
                    }}
                  >
                    <option value="" disabled>
                      Selecione...
                    </option>
                    {Object.values(PromotionStatus).map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                ),
              },
            ]}
            rows={promotions ?? []}
            rowKey={(p) => p.id}
            emptyMessage="Nenhuma promoção cadastrada."
          />
        )}
      </Card>

      <Modal open={promotionModalOpen} onClose={() => setPromotionModalOpen(false)} title="Nova promoção">
        <div className="space-y-4">
          <FormField label="Título">
            <Input value={promotionForm.title} onChange={(e) => setPromotionForm((f) => ({ ...f, title: e.target.value }))} />
          </FormField>
          <FormField label="Descrição">
            <Textarea
              value={promotionForm.description}
              onChange={(e) => setPromotionForm((f) => ({ ...f, description: e.target.value }))}
            />
          </FormField>
          <FormField label="Tipo de desconto">
            <Select
              value={promotionForm.discountType}
              onChange={(e) => setPromotionForm((f) => ({ ...f, discountType: e.target.value }))}
            >
              <option value="PERCENTUAL">Percentual (%)</option>
              <option value="VALOR_FIXO">Valor fixo (R$)</option>
            </Select>
          </FormField>
          <FormField label="Valor do desconto">
            <Input
              type="number"
              step="0.01"
              value={promotionForm.discountValue}
              onChange={(e) => setPromotionForm((f) => ({ ...f, discountValue: e.target.value }))}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Início da oferta">
              <Input
                type="datetime-local"
                value={promotionForm.startsAt}
                onChange={(e) => setPromotionForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </FormField>
            <FormField label="Fim da oferta">
              <Input
                type="datetime-local"
                value={promotionForm.endsAt}
                onChange={(e) => setPromotionForm((f) => ({ ...f, endsAt: e.target.value }))}
              />
            </FormField>
          </div>
          <Button
            className="w-full"
            disabled={!promotionForm.title || !promotionForm.discountValue}
            isLoading={createPromotion.isPending}
            onClick={() => createPromotion.mutate()}
          >
            Criar promoção
          </Button>
        </div>
      </Modal>
    </div>
  );
}
