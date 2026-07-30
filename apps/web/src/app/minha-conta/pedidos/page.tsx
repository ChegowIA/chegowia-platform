"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Order } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/ui/badge";

export default function MyOrdersPage() {
  const router = useRouter();

  const { data: orders, isLoading } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => {
      const { data } = await api.get<Order[]>("/me/orders");
      return data;
    },
  });

  const repeatOrder = useMutation({
    mutationFn: async (orderId: string) => {
      const { data } = await api.post<Order>(`/me/orders/${orderId}/repeat`);
      return data;
    },
    onSuccess: (order) => router.push(`/pedido/${order.id}`),
  });

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-50">Meus pedidos</h1>

        {isLoading && <p className="text-slate-500">Carregando pedidos...</p>}
        {!isLoading && orders?.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-slate-500">Você ainda não fez nenhum pedido.</CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {orders?.map((order) => (
            <Card key={order.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link
                    href={`/pedido/${order.id}`}
                    className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                  >
                    Pedido #{order.id.slice(0, 8)}
                  </Link>
                  <p className="text-sm text-slate-500">
                    {formatDateTime(order.createdAt)} · {order.company?.name}
                  </p>
                  <p className="text-sm text-slate-500">{formatCurrency(order.total)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <OrderStatusBadge status={order.status} />
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={repeatOrder.isPending && repeatOrder.variables === order.id}
                    onClick={() => repeatOrder.mutate(order.id)}
                  >
                    Repetir pedido
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {repeatOrder.isError && <p className="mt-3 text-sm text-red-600">{apiErrorMessage(repeatOrder.error)}</p>}
      </main>
    </>
  );
}
