"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_STATUS_FLOW, OrderStatus, Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Employee, Order } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { storedOptionSelectionsLabel } from "@/lib/product-options";
import { useAuthStore } from "@/lib/auth-store";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { OrderStatusBadge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";

export default function PedidoDetalhePage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [error, setError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<string>("");
  const [motoboyId, setMotoboyId] = useState<string>("");
  const [whatsappInfo, setWhatsappInfo] = useState<{ link: string; summary: string } | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const { data } = await api.get<Order>(`/orders/${orderId}`);
      return data;
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["employees-motoboys"],
    queryFn: async () => {
      const { data } = await api.get<Employee[]>("/employees");
      return data;
    },
    enabled: user?.role !== Role.MOTOBOY,
  });

  const motoboys = (employees ?? []).filter((e) => e.user.role === Role.MOTOBOY && e.user.isActive);

  const statusOptions = useMemo(() => {
    if (!order) return [];
    if (order.status === OrderStatus.ENTREGUE || order.status === OrderStatus.CANCELADO) return [];

    if (user?.role === Role.COZINHA) {
      return [OrderStatus.EM_PREPARO, OrderStatus.PRONTO];
    }

    const currentIndex = ORDER_STATUS_FLOW.indexOf(order.status);
    const options: OrderStatus[] = [];
    if (currentIndex >= 0 && currentIndex + 1 < ORDER_STATUS_FLOW.length) {
      options.push(ORDER_STATUS_FLOW[currentIndex + 1]);
    }
    options.push(OrderStatus.CANCELADO);
    return options;
  }, [order, user]);

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const { data } = await api.patch(`/orders/${orderId}/status`, { status });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setNextStatus("");
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch(`/orders/${orderId}/payment/paid`);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["order", orderId] }),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const assignMotoboy = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch(`/deliveries/order/${orderId}/assign`, { motoboyId });
      return data;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const fetchWhatsapp = useMutation({
    mutationFn: async () => {
      const { data } = await api.get<{ link: string; summary: string }>(`/messaging/orders/${orderId}/whatsapp-link`);
      return data;
    },
    onSuccess: (data) => {
      setWhatsappInfo(data);
      window.open(data.link, "_blank");
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  if (isLoading) return <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>;
  if (!order) return <p className="text-sm text-slate-500 dark:text-slate-400">Pedido não encontrado.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Pedido #{order.id.slice(0, 8)}</h1>
        <OrderStatusBadge status={order.status} />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Itens</CardTitle>
            </CardHeader>
            <Table
              columns={[
                { header: "Produto", render: (i) => i.productName },
                { header: "Variação", render: (i) => i.variationName ?? "-" },
                { header: "Personalização", render: (i) => storedOptionSelectionsLabel(i.optionSelections) || "-" },
                { header: "Qtd", render: (i) => i.quantity },
                { header: "Unitário", render: (i) => formatCurrency(Number(i.unitPrice)) },
                { header: "Total", render: (i) => formatCurrency(Number(i.totalPrice)) },
              ]}
              rows={order.items}
              rowKey={(i) => i.id}
            />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Histórico de status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {order.statusHistory.map((h, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <OrderStatusBadge status={h.status} />
                  <span className="text-slate-500 dark:text-slate-400">{formatDateTime(h.createdAt)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium text-slate-900 dark:text-slate-100">{order.customer?.name ?? order.customerName ?? "-"}</p>
              <p className="text-slate-500 dark:text-slate-400">{order.customer?.email ?? order.customerPhone ?? "-"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Entrega</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
              <p>
                {order.deliveryStreet}, {order.deliveryNumber}
              </p>
              <p>{order.deliveryNeighborhood}</p>
              <p>
                {order.deliveryCity} - {order.deliveryState}
              </p>
              {order.deliveryDistanceKm !== null && order.deliveryDistanceKm !== undefined && (
                <p className="pt-2 text-slate-500 dark:text-slate-400">
                  Rota calculada: {Number(order.deliveryDistanceKm).toFixed(2)} km
                  {order.deliveryRouteDurationMinutes ? ` · ~${order.deliveryRouteDurationMinutes} min` : ""}
                </p>
              )}
              {order.delivery && (
                <p className="pt-2 text-slate-500 dark:text-slate-400">
                  Status da entrega: <strong>{order.delivery.status.replaceAll("_", " ")}</strong>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pagamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Subtotal: {formatCurrency(Number(order.subtotal))} · Taxa: {formatCurrency(Number(order.deliveryFee))}
              </p>
              <p className="font-semibold">Total: {formatCurrency(Number(order.total))}</p>
              <p>
                Método: {order.paymentMethod.replaceAll("_", " ")} · Status: <strong>{order.paymentStatus}</strong>
              </p>
            </CardContent>
            {order.paymentStatus !== "PAGO" && (
              <CardActions>
                <Button className="w-full sm:w-auto" variant="outline" isLoading={markPaid.isPending} onClick={() => markPaid.mutate()}>
                  Marcar pagamento como pago
                </Button>
              </CardActions>
            )}
          </Card>

          {statusOptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Atualizar status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                  <option value="">Selecione...</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
              </CardContent>
              <CardActions>
                <Button
                  className="w-full sm:w-auto"
                  disabled={!nextStatus}
                  isLoading={updateStatus.isPending}
                  onClick={() => updateStatus.mutate(nextStatus)}
                >
                  Atualizar
                </Button>
              </CardActions>
            </Card>
          )}

          {user?.role !== Role.MOTOBOY && user?.role !== Role.COZINHA && !order.delivery?.motoboyId && (
            <Card>
              <CardHeader>
                <CardTitle>Atribuir motoboy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={motoboyId} onChange={(e) => setMotoboyId(e.target.value)}>
                  <option value="">Selecione um motoboy...</option>
                  {motoboys.map((m) => (
                    <option key={m.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
                </Select>
              </CardContent>
              <CardActions>
                <Button
                  className="w-full sm:w-auto"
                  disabled={!motoboyId}
                  isLoading={assignMotoboy.isPending}
                  onClick={() => assignMotoboy.mutate()}
                >
                  Atribuir
                </Button>
              </CardActions>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {whatsappInfo?.summary ?? "Gere um link para continuar o atendimento deste pedido pelo WhatsApp."}
              </p>
            </CardContent>
            <CardActions>
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                isLoading={fetchWhatsapp.isPending}
                onClick={() => fetchWhatsapp.mutate()}
              >
                Link WhatsApp
              </Button>
            </CardActions>
          </Card>
        </div>
      </div>
    </div>
  );
}
