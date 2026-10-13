"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { deliveryDestination, googleMapsRouteUrl, LatLng } from "@/lib/delivery-maps";
import { Delivery, Order } from "@/lib/types";
import { storedOptionSelectionsLabel } from "@/lib/product-options";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { connectSocket, disconnectSocket } from "@/lib/socket-client";
import { PublicHeader } from "@/components/layout/public-header";
import { DeliveryLocationMap } from "@/components/deliveries/delivery-location-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function OrderTrackingPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useQuery({
    queryKey: ["my-order", id],
    queryFn: async () => {
      const { data } = await api.get<Order>(`/me/orders/${id}`);
      return data;
    },
    refetchInterval: 10000,
  });

  useEffect(() => {
    const socket = connectSocket();
    function handleStatusChanged(payload: Order) {
      if (payload?.id === id) {
        queryClient.setQueryData(["my-order", id], payload);
      }
    }
    function handleDeliveryUpdated(payload: Delivery) {
      if (payload?.order?.id === id) {
        queryClient.invalidateQueries({ queryKey: ["my-order", id] });
      }
    }
    socket.on("order.status_changed", handleStatusChanged);
    socket.on("delivery.location_updated", handleDeliveryUpdated);
    socket.on("delivery.updated", handleDeliveryUpdated);
    return () => {
      socket.off("order.status_changed", handleStatusChanged);
      socket.off("delivery.location_updated", handleDeliveryUpdated);
      socket.off("delivery.updated", handleDeliveryUpdated);
      disconnectSocket();
    };
  }, [id, queryClient]);

  async function handleWhatsapp() {
    const { data } = await api.get<{ link: string }>(`/messaging/my-orders/${id}/whatsapp-link`);
    window.open(data.link, "_blank");
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {isLoading && <p className="text-slate-500 dark:text-slate-400">Carregando pedido...</p>}
        {!isLoading && !order && <p className="text-slate-500 dark:text-slate-400">Pedido não encontrado.</p>}
        {order && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Pedido #{order.id.slice(0, 8)}</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {formatDateTime(order.createdAt)} · {order.company?.name}
                </p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Andamento</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {order.statusHistory.map((h, idx) => (
                    <li key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-slate-200">{h.status.replaceAll("_", " ")}</span>
                      <span className="text-slate-400">{formatDateTime(h.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Itens</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-slate-100 dark:divide-slate-800">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between py-2 text-sm first:pt-0 last:pb-0">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {item.quantity}x {item.productName}
                      </p>
                      {item.variationName && <p className="text-slate-500 dark:text-slate-400">{item.variationName}</p>}
                      {item.addons && item.addons.length > 0 && (
                        <p className="text-slate-500 dark:text-slate-400">+ {item.addons.map((a) => a.name).join(", ")}</p>
                      )}
                      {storedOptionSelectionsLabel(item.optionSelections) && (
                        <p className="text-slate-500 dark:text-slate-400">{storedOptionSelectionsLabel(item.optionSelections)}</p>
                      )}
                      {item.notes && <p className="italic text-slate-400">Obs: {item.notes}</p>}
                    </div>
                    <span className="text-slate-900 dark:text-slate-100">{formatCurrency(item.totalPrice)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

	            <Card>
	              <CardHeader>
	                <CardTitle>Entrega</CardTitle>
	              </CardHeader>
	              <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
	                <p>
	                  {order.deliveryStreet}, {order.deliveryNumber}
	                </p>
	                <p>
	                  {order.deliveryNeighborhood} - {order.deliveryCity}/{order.deliveryState}
	                </p>
	                {order.delivery?.motoboy ? (
	                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:bg-slate-800/60 dark:border-slate-800">
	                    <p className="font-semibold text-slate-900 dark:text-slate-100">Motoboy: {order.delivery.motoboy.name}</p>
	                    <p className="text-xs text-slate-500 dark:text-slate-400">
	                      {order.delivery.motoboyLocationUpdatedAt
	                        ? `Localização atualizada em ${formatDateTime(order.delivery.motoboyLocationUpdatedAt)}`
	                        : "Aguardando compartilhamento de localização."}
	                    </p>
	                  </div>
	                ) : (
	                  <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500 dark:bg-slate-800/60 dark:border-slate-800 dark:text-slate-400">
	                    A loja ainda não atribuiu um motoboy para esta entrega.
	                  </p>
	                )}
	                {order.delivery?.motoboyId && (
	                  <>
	                    <DeliveryLocationMap
	                      position={deliveryPosition(order)}
	                      updatedAt={order.delivery.motoboyLocationUpdatedAt}
	                    />
	                    <Button
	                      type="button"
	                      variant="outline"
	                      className="w-full"
	                      onClick={() =>
	                        window.open(
	                          googleMapsRouteUrl(deliveryDestination(order), deliveryPosition(order) ?? undefined),
	                          "_blank",
	                        )
	                      }
	                    >
	                      Ver rota do motoboy
	                    </Button>
	                  </>
	                )}
	              </CardContent>
	            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pagamento e total</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Taxa de entrega</span>
                  <span>{formatCurrency(order.deliveryFee)}</span>
                </div>
                {order.deliveryDistanceKm !== null && order.deliveryDistanceKm !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Rota estimada</span>
                    <span>
                      {Number(order.deliveryDistanceKm).toFixed(2)} km
                      {order.deliveryRouteDurationMinutes ? ` · ~${order.deliveryRouteDurationMinutes} min` : ""}
                    </span>
                  </div>
                )}
                {order.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Desconto</span>
                    <span>-{formatCurrency(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold dark:border-slate-800">
                  <span>Total</span>
                  <span>{formatCurrency(order.total)}</span>
                </div>
              </CardContent>
            </Card>

            <Button className="w-full" variant="outline" onClick={handleWhatsapp}>
              Falar com a loja no WhatsApp
            </Button>
          </div>
        )}
      </main>
    </>
	  );
	}

function deliveryPosition(order: Order): LatLng | null {
  if (typeof order.delivery?.motoboyLatitude !== "number" || typeof order.delivery?.motoboyLongitude !== "number") return null;
  return { latitude: order.delivery.motoboyLatitude, longitude: order.delivery.motoboyLongitude };
}
