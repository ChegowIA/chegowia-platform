"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DELIVERY_PROBLEM_REASON_LABELS,
  DeliveryProblemReason,
  DeliveryStatus,
  PermissionKey,
  Role,
} from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { deliveryAddressLabel, googleMapsRouteUrl, LatLng } from "@/lib/delivery-maps";
import { Delivery, Employee } from "@/lib/types";
import { connectSocket } from "@/lib/socket-client";
import { useAuthStore } from "@/lib/auth-store";
import { MotoboyAssistant } from "@/components/ai/motoboy-assistant";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Column, Table } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";

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

const PROBLEM_REASON_META: Record<DeliveryProblemReason, { icon: string; help: string }> = {
  [DeliveryProblemReason.CLIENTE_NAO_ATENDEU]: { icon: "☎", help: "Tentativas de contato sem resposta" },
  [DeliveryProblemReason.ENDERECO_NAO_LOCALIZADO]: { icon: "📍", help: "Número ou localização não encontrados" },
  [DeliveryProblemReason.CLIENTE_RECUSOU]: { icon: "×", help: "O cliente não quis receber o pedido" },
  [DeliveryProblemReason.VEICULO_COM_PROBLEMA]: { icon: "⚙", help: "Falha mecânica, pneu ou combustível" },
  [DeliveryProblemReason.PEDIDO_DANIFICADO]: { icon: "!", help: "Embalagem ou conteúdo comprometido" },
  [DeliveryProblemReason.AREA_DE_RISCO]: { icon: "△", help: "Não foi possível acessar com segurança" },
  [DeliveryProblemReason.OUTRO]: { icon: "…", help: "Uma situação diferente das opções acima" },
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
  const [problemDelivery, setProblemDelivery] = useState<Delivery | null>(null);
  const [incidentDelivery, setIncidentDelivery] = useState<Delivery | null>(null);
  const [problemReason, setProblemReason] = useState<DeliveryProblemReason | null>(null);
  const [problemDescription, setProblemDescription] = useState("");

  const isMotoboy = user?.role === Role.MOTOBOY;
  const canEditDeliveries = user?.role === Role.ADMIN || user?.permissionKeys?.includes(PermissionKey.ENTREGAS_EDITAR);
  const canViewEmployees = user?.role === Role.ADMIN || user?.permissionKeys?.includes(PermissionKey.FUNCIONARIOS_VISUALIZAR);

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
    enabled: !isMotoboy && Boolean(canEditDeliveries && canViewEmployees),
  });
  const motoboys = (employees ?? []).filter((e) => e.user.role === Role.MOTOBOY && e.user.isActive);

  useEffect(() => {
    const socket = connectSocket();
    const refetch = () => queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    socket.on("delivery.updated", refetch);
    return () => {
      socket.off("delivery.updated", refetch);
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
    mutationFn: async (payload: {
      id: string;
      status: DeliveryStatus;
      problemReason?: DeliveryProblemReason;
      problemDescription?: string;
    }) => {
      const { id, ...body } = payload;
      const { data } = await api.patch(`/deliveries/${id}/status`, body);
      return data;
    },
    onSuccess: () => {
      setError(null);
      setProblemDelivery(null);
      setProblemReason(null);
      setProblemDescription("");
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
    if (!isMotoboy || !canEditDeliveries || !trackingEnabled) return;
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
  }, [activeDeliveryIds, canEditDeliveries, isMotoboy, queryClient, trackingEnabled]);

  const columns: Column<Delivery>[] = [
    { header: "Cliente", render: (d) => d.order.customer?.name ?? d.order.customerName ?? "-" },
    {
      header: isMotoboy ? "Destino" : "Bairro",
      render: (d) =>
        isMotoboy ? (
          <div>
            <p className="font-medium text-slate-900 dark:text-slate-100">{d.order.deliveryStreet}, {d.order.deliveryNumber}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {d.order.deliveryNeighborhood} - {d.order.deliveryCity}/{d.order.deliveryState}
            </p>
          </div>
        ) : (
          d.order.deliveryNeighborhood
        ),
    },
    {
      header: "Status",
      render: (d) => (
        <div>
          <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status.replaceAll("_", " ")}</Badge>
          {d.status === DeliveryStatus.PROBLEMA && d.problemReason && (
            <p className="mt-1 max-w-[190px] text-xs font-semibold text-rose-700 dark:text-rose-300">
              {DELIVERY_PROBLEM_REASON_LABELS[d.problemReason]}
            </p>
          )}
          {Boolean(d.incidents?.length) && (
            <button
              type="button"
              className="mt-1 block text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 dark:text-slate-400"
              onClick={() => setIncidentDelivery(d)}
            >
              {d.incidents!.length} ocorrência(s)
            </button>
          )}
        </div>
      ),
    },
    ...(!isMotoboy && canEditDeliveries && canViewEmployees
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
            {isMotoboy && canEditDeliveries && next && (
              <Button size="sm" isLoading={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: d.id, status: next })}>
                {next.replaceAll("_", " ")}
              </Button>
            )}
            {isMotoboy && canEditDeliveries && d.status === DeliveryStatus.PROBLEMA && d.statusBeforeProblem && (
              <Button
                size="sm"
                isLoading={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ id: d.id, status: d.statusBeforeProblem! })}
              >
                Retomar entrega
              </Button>
            )}
            {isMotoboy && canEditDeliveries && d.status !== DeliveryStatus.ENTREGUE && d.status !== DeliveryStatus.PROBLEMA && (
              <Button
                size="sm"
                variant="danger"
                isLoading={updateStatus.isPending}
                onClick={() => setProblemDelivery(d)}
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
      <div className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-7 text-white shadow-2xl sm:px-8">
        <div className="relative">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-accent-300">{isMotoboy ? "Minha rota" : "Logística em tempo real"}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{isMotoboy ? "Suas entregas de hoje" : "Central de entregas"}</h1>
          <p className="mt-1 text-sm text-slate-300">{isMotoboy ? "Atualize cada etapa e mantenha o cliente informado." : "Atribua entregadores e acompanhe cada pedido até o destino."}</p>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      {trackingError && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{trackingError}</p>}

      {isMotoboy && canEditDeliveries && (
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold text-slate-900 dark:text-slate-100">Localização em tempo real</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
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
                      <p className="font-bold text-slate-900 dark:text-slate-100">{delivery.order.customer?.name ?? delivery.order.customerName ?? "Cliente"}</p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {delivery.order.deliveryStreet}, {delivery.order.deliveryNumber}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {delivery.order.deliveryNeighborhood} - {delivery.order.deliveryCity}/{delivery.order.deliveryState}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[delivery.status] ?? "neutral"}>{delivery.status.replaceAll("_", " ")}</Badge>
                  </div>
                  {Boolean(delivery.incidents?.length) && (
                    <button
                      type="button"
                      className="text-left text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-2 dark:text-slate-400"
                      onClick={() => setIncidentDelivery(delivery)}
                    >
                      Ver histórico de {delivery.incidents!.length} ocorrência(s)
                    </button>
                  )}
                  <div className="grid grid-cols-1 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(googleMapsRouteUrl(destination, currentPosition ?? undefined), "_blank")}
                    >
                      Abrir rota
                    </Button>
                    {canEditDeliveries && next && (
                      <Button
                        size="sm"
                        isLoading={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: delivery.id, status: next })}
                      >
                        {next.replaceAll("_", " ")}
                      </Button>
                    )}
                    {canEditDeliveries && delivery.status === DeliveryStatus.PROBLEMA && delivery.statusBeforeProblem && (
                      <Button
                        size="sm"
                        isLoading={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: delivery.id, status: delivery.statusBeforeProblem! })}
                      >
                        Retomar entrega
                      </Button>
                    )}
                    {canEditDeliveries && delivery.status !== DeliveryStatus.ENTREGUE && delivery.status !== DeliveryStatus.PROBLEMA && (
                      <Button
                        size="sm"
                        variant="danger"
                        isLoading={updateStatus.isPending}
                        onClick={() => setProblemDelivery(delivery)}
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
            <Card className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Nenhuma entrega encontrada.</Card>
          )}
        </div>
      )}

      <Card className={isMotoboy ? "hidden overflow-hidden sm:block" : "overflow-hidden"}>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
        ) : (
          <Table
            columns={columns}
            rows={deliveries ?? []}
            rowKey={(d) => d.id}
            emptyMessage="Nenhuma entrega encontrada."
          />
        )}
      </Card>

      <Modal
        open={Boolean(problemDelivery)}
        onClose={() => {
          if (updateStatus.isPending) return;
          setProblemDelivery(null);
          setProblemReason(null);
          setProblemDescription("");
        }}
        title="Registrar problema na entrega"
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/30 dark:border-amber-900/60">
            <p className="text-sm font-black text-amber-950 dark:text-amber-200">O pedido continuará aberto</p>
            <p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-300">
              A empresa e o cliente serão avisados. Depois de resolver, toque em “Retomar entrega”.
            </p>
          </div>
          <div>
            <p className="mb-3 text-sm font-black text-slate-900 dark:text-slate-100">O que aconteceu?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.values(DeliveryProblemReason).map((reason) => {
                const selected = problemReason === reason;
                const meta = PROBLEM_REASON_META[reason];
                return (
                  <button
                    key={reason}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setProblemReason(reason)}
                    className={`flex min-h-[82px] items-start gap-3 rounded-2xl border p-3 text-left transition ${
                      selected
                        ? "border-rose-500 bg-rose-50 shadow-[0_8px_24px_rgba(244,63,94,.12)] dark:bg-rose-950/30"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800"
                    }`}
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg font-black ${
                      selected ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}>{meta.icon}</span>
                    <span>
                      <span className="block text-sm font-black text-slate-900 dark:text-slate-100">
                        {DELIVERY_PROBLEM_REASON_LABELS[reason]}
                      </span>
                      <span className="mt-1 block text-xs leading-4 text-slate-500 dark:text-slate-400">{meta.help}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-black text-slate-800 dark:text-slate-200">
              Observação {problemReason === DeliveryProblemReason.OUTRO ? "(obrigatória)" : "(opcional)"}
            </label>
            <Textarea
              maxLength={500}
              placeholder="Inclua detalhes que ajudem a equipe a resolver a situação."
              value={problemDescription}
              onChange={(event) => setProblemDescription(event.target.value)}
            />
            <p className="mt-1 text-right text-xs text-slate-400">{problemDescription.length}/500</p>
          </div>
          {updateStatus.error && (
            <p className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              {apiErrorMessage(updateStatus.error)}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => setProblemDelivery(null)}
              disabled={updateStatus.isPending}
            >
              Voltar
            </Button>
            <Button
              variant="danger"
              isLoading={updateStatus.isPending}
              disabled={
                !problemReason
                || (problemReason === DeliveryProblemReason.OUTRO && !problemDescription.trim())
              }
              onClick={() => problemDelivery && problemReason && updateStatus.mutate({
                id: problemDelivery.id,
                status: DeliveryStatus.PROBLEMA,
                problemReason,
                problemDescription: problemDescription.trim() || undefined,
              })}
            >
              Confirmar problema
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(incidentDelivery)}
        onClose={() => setIncidentDelivery(null)}
        title="Histórico de ocorrências"
      >
        <div className="space-y-3">
          {(incidentDelivery?.incidents ?? []).map((incident, index) => (
            <article
              key={incident.id}
              className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800"
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-rose-500" />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-950 dark:text-slate-100">
                    {DELIVERY_PROBLEM_REASON_LABELS[incident.reason]}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Ocorrência {incidentDelivery!.incidents!.length - index} · etapa{" "}
                    {incident.previousStatus.replaceAll("_", " ").toLowerCase()}
                  </p>
                </div>
                <Badge tone={incident.resolvedAt ? "success" : "danger"}>
                  {incident.resolvedAt ? "Resolvida" : "Em aberto"}
                </Badge>
              </div>
              {incident.description && (
                <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  {incident.description}
                </p>
              )}
              <p className="mt-3 text-xs text-slate-400">
                Registrada em {new Date(incident.reportedAt).toLocaleString("pt-BR")}
                {incident.resolvedAt
                  ? ` · resolvida em ${new Date(incident.resolvedAt).toLocaleString("pt-BR")}`
                  : ""}
              </p>
            </article>
          ))}
          {(incidentDelivery?.incidents ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Nenhuma ocorrência registrada.</p>
          )}
          <Button variant="outline" className="w-full" onClick={() => setIncidentDelivery(null)}>
            Fechar
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function deliveryPosition(delivery: Delivery): LatLng | null {
  if (typeof delivery.motoboyLatitude !== "number" || typeof delivery.motoboyLongitude !== "number") return null;
  return { latitude: delivery.motoboyLatitude, longitude: delivery.motoboyLongitude };
}
