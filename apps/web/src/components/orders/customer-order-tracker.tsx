"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_STATUS_FLOW, OrderStatus, Role } from "@chegowia/shared";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { connectSocket } from "@/lib/socket-client";
import { Order } from "@/lib/types";
import { BrandLogo } from "@/components/brand/brand-logo";

const ACTIVE_STATUSES = new Set<OrderStatus>([
  OrderStatus.RECEBIDO,
  OrderStatus.CONFIRMADO,
  OrderStatus.EM_PREPARO,
  OrderStatus.PRONTO,
  OrderStatus.SAIU_PARA_ENTREGA,
]);

const STEPS = [
  { label: "Confirmado", status: OrderStatus.CONFIRMADO },
  { label: "Preparando", status: OrderStatus.EM_PREPARO },
  { label: "Pronto", status: OrderStatus.PRONTO },
  { label: "A caminho", status: OrderStatus.SAIU_PARA_ENTREGA },
  { label: "Chegou", status: OrderStatus.ENTREGUE },
];

export function CustomerOrderTracker() {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
  const queryClient = useQueryClient();
  const [liveOrder, setLiveOrder] = useState<Order | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [celebrating, setCelebrating] = useState(false);
  const lastStatus = useRef<OrderStatus | null>(null);
  const isCustomer = user?.role === Role.CLIENTE && Boolean(accessToken) && !isSessionLoading;

  const { data: orders } = useQuery({
    queryKey: ["customer-live-orders"],
    queryFn: async () => {
      const { data } = await api.get<Order[]>("/me/orders");
      return data;
    },
    enabled: isCustomer,
    refetchInterval: 20000,
  });

  const activeOrder = useMemo(
    () => orders?.find((order) => ACTIVE_STATUSES.has(order.status)) ?? null,
    [orders],
  );

  useEffect(() => {
    if (activeOrder) setLiveOrder(activeOrder);
    else if (!celebrating) setLiveOrder(null);
  }, [activeOrder, celebrating]);

  useEffect(() => {
    if (!isCustomer) return;
    const socket = connectSocket();

    function handleStatusChanged(payload: Order) {
      queryClient.invalidateQueries({ queryKey: ["customer-live-orders"] });
      queryClient.invalidateQueries({ queryKey: ["header-my-orders"] });
      if (liveOrder && payload?.id !== liveOrder.id) return;

      setLiveOrder((current) =>
        current?.id === payload.id
          ? { ...current, status: payload.status, updatedAt: payload.updatedAt }
          : current,
      );
      setExpanded(true);
      if (payload.status === OrderStatus.ENTREGUE) {
        setCelebrating(true);
        window.setTimeout(() => {
          setCelebrating(false);
          setLiveOrder(null);
        }, 12000);
      }
      if (payload.status === OrderStatus.CANCELADO) setLiveOrder(null);
    }

    socket.on("order.status_changed", handleStatusChanged);
    return () => {
      socket.off("order.status_changed", handleStatusChanged);
    };
  }, [isCustomer, liveOrder, queryClient]);

  useEffect(() => {
    if (!liveOrder || lastStatus.current === liveOrder.status) return;
    lastStatus.current = liveOrder.status;
    setExpanded(true);
  }, [liveOrder]);

  if (!isCustomer || !liveOrder) return null;

  const status = statusContent(liveOrder);
  const progress = orderProgress(liveOrder.status);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="order-tracker-enter fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-4 z-[55] flex items-center gap-3 rounded-full border border-slate-200 bg-white p-2 pr-5 shadow-2xl transition hover:-translate-y-1 sm:bottom-6 sm:left-6 dark:bg-slate-900 dark:border-slate-800"
      >
        <span className="relative grid h-11 w-11 place-items-center rounded-full bg-brand-50 dark:bg-brand-950/30">
          <BrandLogo adaptive variant="mark" className="h-8 w-8" />
          <span className="absolute right-0 top-0 h-3 w-3 animate-pulse rounded-full border-2 border-white bg-emerald-500" />
        </span>
        <span className="text-left">
          <span className="block text-[10px] font-black uppercase tracking-wider text-brand-600">Pedido em andamento</span>
          <span className="block text-sm font-black text-slate-950 dark:text-slate-100">{status.title}</span>
        </span>
      </button>
    );
  }

  return (
    <aside
      aria-live="polite"
      className="order-tracker-enter fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[55] overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-[0_28px_80px_-30px_rgba(15,23,42,.6)] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[410px] dark:bg-slate-900 dark:border-slate-800/80"
    >
      <div className="relative overflow-hidden bg-slate-950 px-5 pb-5 pt-4 text-white">
        <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-brand-600/35 blur-3xl" />
        {celebrating && <div className="order-confetti absolute inset-0" aria-hidden="true" />}
        <div className="relative flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white dark:bg-slate-900">
            <BrandLogo adaptive variant="mark" className="h-9 w-9" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-brand-300">
                Pedido #{liveOrder.id.slice(0, 6)}
              </p>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-[10px] font-bold text-emerald-300">Atualização ao vivo</span>
            </div>
            <h2 className="mt-1 text-lg font-black">{status.title}</h2>
            <p className="mt-0.5 text-sm text-slate-300">{status.description}</p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Minimizar acompanhamento"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <span className="h-0.5 w-3 rounded bg-current" />
          </button>
        </div>
      </div>

      <div className="p-5">
        <div className="relative">
          <div className="absolute left-3 right-3 top-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="order-progress-shine h-full rounded-full bg-brand-600 transition-[width] duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="relative flex justify-between">
            {STEPS.map((step) => {
              const reached = isStepReached(liveOrder.status, step.status);
              const current = step.status === normalizedStepStatus(liveOrder.status);
              return (
                <div key={step.status} className="flex w-16 flex-col items-center text-center">
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full border-2 text-[10px] font-black transition duration-500 ${
                      reached
                        ? "border-brand-600 bg-brand-600 text-white shadow-[0_0_0_4px_rgba(249,115,22,.12)]"
                        : "border-slate-200 bg-white text-slate-300 dark:bg-slate-900 dark:border-slate-800"
                    } ${current ? "order-current-step" : ""}`}
                  >
                    {reached ? "✓" : ""}
                  </span>
                  <span className={`mt-2 text-[9px] font-black uppercase tracking-tight ${reached ? "text-slate-700 dark:text-slate-300" : "text-slate-300"}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          <div>
            <p className="text-xs text-slate-400">{liveOrder.company?.name ?? "Sua loja"}</p>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{liveOrder.items.length} {liveOrder.items.length === 1 ? "item" : "itens"} no pedido</p>
          </div>
          <Link
            href={`/pedido/${liveOrder.id}`}
            className="rounded-xl bg-brand-50 px-4 py-2.5 text-sm font-black text-brand-700 transition hover:bg-brand-600 hover:text-white"
          >
            Ver detalhes
          </Link>
        </div>
      </div>
    </aside>
  );
}

function orderProgress(status: OrderStatus) {
  const index = ORDER_STATUS_FLOW.indexOf(status);
  return index < 0 ? 0 : Math.max(8, (index / (ORDER_STATUS_FLOW.length - 1)) * 100);
}

function normalizedStepStatus(status: OrderStatus) {
  if (status === OrderStatus.RECEBIDO) return OrderStatus.CONFIRMADO;
  return status;
}

function isStepReached(current: OrderStatus, step: OrderStatus) {
  const currentIndex = ORDER_STATUS_FLOW.indexOf(current);
  const stepIndex = ORDER_STATUS_FLOW.indexOf(step);
  return currentIndex >= stepIndex || (current === OrderStatus.RECEBIDO && step === OrderStatus.CONFIRMADO);
}

function statusContent(order: Order) {
  const company = order.company?.name ?? "A loja";
  const content: Record<OrderStatus, { title: string; description: string }> = {
    RECEBIDO: { title: "Pedido recebido!", description: `${company} já recebeu seu pedido.` },
    CONFIRMADO: { title: "Pedido confirmado", description: "Tudo certo. A loja vai começar a preparar." },
    EM_PREPARO: { title: "Preparando seu pedido", description: "A cozinha está cuidando de tudo agora." },
    PRONTO: { title: "Seu pedido está pronto", description: "Só falta sair para a entrega." },
    SAIU_PARA_ENTREGA: { title: "Está a caminho!", description: "Seu pedido saiu para entrega. Já já chega." },
    ENTREGUE: { title: "Pedido entregue!", description: "Chegou! Esperamos que você aproveite." },
    CANCELADO: { title: "Pedido cancelado", description: "Consulte os detalhes do pedido." },
  };
  return content[order.status];
}
