"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Order } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [newOrdersCount, setNewOrdersCount] = useState(0);

  const { data: todayOrders, isLoading: loadingToday } = useQuery({
    queryKey: ["orders-today"],
    queryFn: async () => {
      const { data } = await api.get<Order[]>("/orders/today");
      return data;
    },
  });

  const { data: delayedOrders, isLoading: loadingDelayed } = useQuery({
    queryKey: ["orders-delayed"],
    queryFn: async () => {
      const { data } = await api.get<Order[]>("/orders/delayed");
      return data;
    },
  });

  useEffect(() => {
    const socket = connectSocket();
    const onCreated = () => {
      setNewOrdersCount((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ["orders-today"] });
      queryClient.invalidateQueries({ queryKey: ["orders-delayed"] });
    };
    const onStatusChanged = () => {
      queryClient.invalidateQueries({ queryKey: ["orders-today"] });
      queryClient.invalidateQueries({ queryKey: ["orders-delayed"] });
    };
    socket.on("order.created", onCreated);
    socket.on("order.status_changed", onStatusChanged);
    return () => {
      socket.off("order.created", onCreated);
      socket.off("order.status_changed", onStatusChanged);
      disconnectSocket();
    };
  }, [queryClient]);

  const revenueToday = (todayOrders ?? []).reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Dashboard</h1>
        {newOrdersCount > 0 && (
          <button
            onClick={() => setNewOrdersCount(0)}
            className="rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow hover:bg-brand-700"
          >
            {newOrdersCount} novo{newOrdersCount > 1 ? "s" : ""} pedido{newOrdersCount > 1 ? "s" : ""}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Pedidos hoje</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
              {loadingToday ? "..." : todayOrders?.length ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Receita hoje</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">{formatCurrency(revenueToday)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pedidos atrasados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-600">{loadingDelayed ? "..." : delayedOrders?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Pedidos atrasados</CardTitle>
          <Link href="/painel/pedidos">
            <Button variant="outline" size="sm">
              Ver todos os pedidos
            </Button>
          </Link>
        </CardHeader>
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
                  Ver
                </Link>
              ),
            },
          ]}
          rows={delayedOrders ?? []}
          rowKey={(o) => o.id}
          emptyMessage="Nenhum pedido atrasado. 🎉"
        />
      </Card>
    </div>
  );
}
