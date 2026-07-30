"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeliveryStatus, Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { deliveryAddressLabel, googleMapsRouteUrl, LatLng } from "@/lib/delivery-maps";
import { Delivery, Employee } from "@/lib/types";
import { connectSocket, disconnectSocket } from "@/lib/socket-client";
import { useAuthStore } from "@/lib/auth-store";
import { MotoboyAssistant } from "@/components/ai/motoboy-assistant";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Column, Table } from "@/components/ui/table";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "brand"> = {
  AGUARDANDO_RETIRADA: "neutral",
  RETIRADO: "info",
  EM_ROTA: "brand",
  ENTREGUE: "success",
  PROBLEMA: "danger",
};

const MOTOBOY_NEXT_STATUS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  [DeliveryStatus.AGUARDANDO_RETIRADA]: DeliveryStatus.RETIRADO,
  [DeliveryStatus.RETIRADO]: DeliveryStatus.EM_ROTA,
  [DeliveryStatus.EM_ROTA]: DeliveryStatus.ENTREGUE,
};

export default function EntregasPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [lastLocationSentAt, setLastLocationSentAt] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);

  const isMotoboy = user?.role === Role.MOTOBOY;

  const { data: deliveries, isLoading } = useQuery({
    queryKey: ["deliveries", isMotoboy, statusFilter],
    queryFn: async () => {
      if (isMotoboy) {
        const { data } = await api.get<Delivery[]>("/deliveries/me");
        return data;
      }
      const { data } = await api.get<Delivery[]>("/deliveries", {
        params: { status: statusFilter || undefined },
      });
      return data;
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["employees-motoboys"],
    queryFn: async () => {
      const { data } = await api.get<Employee[]>("/employees");
      return data;
    },
    enabled: !isMotoboy,
  });
  const motoboys = (employees ?? []).filter((e) => e.user.role === Role.MOTOBOY && e.user.isActive);

  useEffect(() => {
    const socket = connectSocket();
    const refetch = () => queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    socket.on("delivery.updated", refetch);
    return () => {
      socket.off("delivery.updated", refetch);
      disconnectSocket();
    };
  }, [queryClient]);

  useEffect(() => {
    const socket = connectSocket();
    const refetch = () => queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    socket.on("delivery.location_updated", refetch);
    return () => {
      socket.off("delivery.location_updated", refetch);
    };
  }, [queryClient]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DeliveryStatus }) => {
      const { data } = await api.patch(`/deliveries/${id}/status`, { status });
      return data;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const assign = useMutation({
    mutationFn: async ({ orderId, motoboyId }: { orderId: string; motoboyId: string }) => {
      const { data } = await api.patch(`/deliveries/order/${orderId}/assign`, { motoboyId });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setAssigningOrderId(null);
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const activeDeliveryIds = useMemo(
    () =>
      (deliveries ?? [])
        .filter((delivery) => delivery.status !== DeliveryStatus.ENTREGUE && delivery.status !== DeliveryStatus.PROBLEMA)
        .map((delivery) => delivery.id),
    [deliveries],
  );

  useEffect(() => {
    if (!isMotoboy || !trackingEnabled) return;
    if (!navigator.geolocation) {
      setTrackingError("Este navegador não permite compartilhar localização.");
      return;
    }
    if (activeDeliveryIds.length === 0) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const payload = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        activeDeliveryIds.forEach((deliveryId) => {
          api
            .patch(`/deliveries/${deliveryId}/location`, payload)
            .then(() => {
              setTrackingError(null);
              setLastLocationSentAt(new Date().toISOString());
              queryClient.invalidateQueries({ queryKey: ["deliveries"] });
            })
            .catch((err) => setTrackingError(apiErrorMessage(err, "Não foi possível enviar sua localização.")));
        });
      },
      () => setTrackingError("Autorize a localização no navegador para compartilhar sua posição."),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeDeliveryIds, isMotoboy, queryClient, trackingEnabled]);

  const columns: Column<Delivery>[] = [
    { header: "Cliente", render: (d) => d.order.customer?.name ?? "-" },
    {
      header: isMotoboy ? "Destino" : "Bairro",
      render: (d) =>
        isMotoboy ? (
          <div>
            <p className="font-medium text-slate-900">{d.order.deliveryStreet}, {d.order.deliveryNumber}</p>
            <p className="text-xs text-slate-500">
              {d.order.deliveryNeighborhood} - {d.order.deliveryCity}/{d.order.deliveryState}
            </p>
          </div>
        ) : (
          d.order.deliveryNeighborhood
        ),
    },
    {
      header: "Status",
      render: (d) => <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status.replaceAll("_", " ")}</Badge>,
    },
    ...(!isMotoboy
      ? [
          {
            header: "Motoboy",
            render: (d: Delivery) =>
              d.motoboy?.name ?? (
                assigningOrderId === d.order.id ? (
                  <div className="flex gap-2">
                    <Select
                      className="min-w-[160px]"
                      defaultValue=""
                      onChange={(e) => assign.mutate({ orderId: d.order.id, motoboyId: e.target.value })}
                    >
                      <option value="" disabled>
                        Selecione...
                      </option>
                      {motoboys.map((m) => (
                        <option key={m.id} value={m.user.id}>
                          {m.user.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <button
                    className="font-medium text-brand-600 hover:underline"
                    onClick={() => setAssigningOrderId(d.order.id)}
                  >
                    Atribuir
                  </button>
                )
              ),
          } satisfies Column<Delivery>,
        ]
      : []),
    {
      header: isMotoboy ? "Rota e ações" : "Rota",
      render: (d) => {
        const next = MOTOBOY_NEXT_STATUS[d.status];
        const destination = deliveryAddressLabel(d.order);
        const currentPosition = deliveryPosition(d);

        return (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(googleMapsRouteUrl(destination, currentPosition ?? undefined), "_blank")}
            >
              Abrir rota
            </Button>
            {isMotoboy && next && (
              <Button size="sm" isLoading={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: d.id, status: next })}>
                {next.replaceAll("_", " ")}
              </Button>
            )}
            {isMotoboy && d.status !== DeliveryStatus.ENTREGUE && d.status !== DeliveryStatus.PROBLEMA && (
              <Button
                size="sm"
                variant="danger"
                isLoading={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ id: d.id, status: DeliveryStatus.PROBLEMA })}
              >
                Problema
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Entregas</h1>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20">{error}</p>}
      {trackingError && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20">{trackingError}</p>}

      {isMotoboy && (
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold text-slate-900">Localização em tempo real</p>
              <p className="text-sm text-slate-500">
                Compartilhe sua posição para o cliente acompanhar a entrega atribuída a você.
              </p>
              {lastLocationSentAt && <p className="mt-1 text-xs text-slate-400">Último envio: {new Date(lastLocationSentAt).toLocaleTimeString("pt-BR")}</p>}
            </div>
            <Button
              type="button"
              variant={trackingEnabled ? "outline" : "primary"}
              disabled={activeDeliveryIds.length === 0}
              onClick={() => setTrackingEnabled((enabled) => !enabled)}
            >
              {trackingEnabled ? "Parar localização" : "Compartilhar localização"}
            </Button>
          </div>
        </Card>
      )}

      {isMotoboy && <MotoboyAssistant />}

      {!isMotoboy && (
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-xs">
          <option value="">Todos os status</option>
          {Object.values(DeliveryStatus).map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      )}

      {isMotoboy && !isLoading && (
        <div className="space-y-3 sm:hidden">
          {(deliveries ?? []).map((delivery) => {
            const next = MOTOBOY_NEXT_STATUS[delivery.status];
            const destination = deliveryAddressLabel(delivery.order);
            const currentPosition = deliveryPosition(delivery);

            return (
              <Card key={delivery.id} className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{delivery.order.customer?.name ?? "Cliente"}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {delivery.order.deliveryStreet}, {delivery.order.deliveryNumber}
                      </p>
                      <p className="text-xs text-slate-500">
                        {delivery.order.deliveryNeighborhood} - {delivery.order.deliveryCity}/{delivery.order.deliveryState}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[delivery.status] ?? "neutral"}>{delivery.status.replaceAll("_", " ")}</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(googleMapsRouteUrl(destination, currentPosition ?? undefined), "_blank")}
                    >
                      Abrir rota
                    </Button>
                    {next && (
                      <Button
                        size="sm"
                        isLoading={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: delivery.id, status: next })}
                      >
                        {next.replaceAll("_", " ")}
                      </Button>
                    )}
                    {delivery.status !== DeliveryStatus.ENTREGUE && delivery.status !== DeliveryStatus.PROBLEMA && (
                      <Button
                        size="sm"
                        variant="danger"
                        isLoading={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: delivery.id, status: DeliveryStatus.PROBLEMA })}
                      >
                        Problema
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
          {(deliveries ?? []).length === 0 && (
            <Card className="px-5 py-8 text-center text-sm text-slate-500">Nenhuma entrega encontrada.</Card>
          )}
        </div>
      )}

      <Card className={isMotoboy ? "hidden overflow-hidden sm:block" : "overflow-hidden"}>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Carregando...</p>
        ) : (
          <Table
            columns={columns}
            rows={deliveries ?? []}
            rowKey={(d) => d.id}
            emptyMessage="Nenhuma entrega encontrada."
          />
        )}
      </Card>
    </div>
  );
}

function deliveryPosition(delivery: Delivery): LatLng | null {
  if (typeof delivery.motoboyLatitude !== "number" || typeof delivery.motoboyLongitude !== "number") return null;
  return { latitude: delivery.motoboyLatitude, longitude: delivery.motoboyLongitude };
}
