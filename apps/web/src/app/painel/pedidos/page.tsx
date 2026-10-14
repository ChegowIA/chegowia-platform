"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_STATUS_FLOW, OrderFulfillmentType, OrderStatus, PermissionKey, Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Employee, Order } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toneColumn } from "@/lib/surface";
import { Input } from "@/components/ui/input";
import { connectSocket } from "@/lib/socket-client";
import { playNewOrderAlert, unlockNewOrderSound } from "@/lib/new-order-sound";
import { isPickupOrder } from "@/lib/order-fulfillment";

const COLUMNS: Array<{
  status: OrderStatus;
  title: string;
  shortTitle: string;
  header: string;
  accent: string;
  surface: string;
  border: string;
}> = [
  { status: OrderStatus.RECEBIDO, title: "Recebidos", shortTitle: "Novos", header: "bg-sky-600", accent: "bg-sky-500", surface: toneColumn("sky"), border: "border-sky-300 dark:border-sky-900/60" },
  { status: OrderStatus.CONFIRMADO, title: "Confirmados", shortTitle: "Confirmados", header: "bg-indigo-600", accent: "bg-indigo-500", surface: toneColumn("indigo"), border: "border-indigo-300 dark:border-indigo-900/60" },
  { status: OrderStatus.EM_PREPARO, title: "Em preparo", shortTitle: "Preparando", header: "bg-amber-500", accent: "bg-amber-500", surface: toneColumn("amber"), border: "border-amber-300 dark:border-amber-900/60" },
  { status: OrderStatus.PRONTO, title: "Prontos", shortTitle: "Prontos", header: "bg-violet-600", accent: "bg-violet-500", surface: toneColumn("violet"), border: "border-violet-300 dark:border-violet-900/60" },
  { status: OrderStatus.SAIU_PARA_ENTREGA, title: "Em entrega", shortTitle: "Em entrega", header: "bg-orange-600", accent: "bg-orange-500", surface: toneColumn("orange"), border: "border-orange-300 dark:border-orange-900/60" },
  { status: OrderStatus.ENTREGUE, title: "Entregues", shortTitle: "Entregues", header: "bg-emerald-600", accent: "bg-emerald-500", surface: toneColumn("emerald"), border: "border-emerald-300 dark:border-emerald-900/60" },
  { status: OrderStatus.CANCELADO, title: "Cancelados", shortTitle: "Cancelados", header: "bg-rose-600", accent: "bg-rose-500", surface: toneColumn("rose"), border: "border-rose-300 dark:border-rose-900/60" },
];

const BOARD_SCROLL_STEP = 400;

interface OrderFlowResponse {
  items: Order[];
  selectedDate: string;
  firstDate: string;
  lastDate: string;
}

export default function PedidosPage() {
  const [search, setSearch] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"ALL" | OrderFulfillmentType>("ALL");
  const [todayDate, setTodayDate] = useState(currentDateKey);
  const [selectedDate, setSelectedDate] = useState(currentDateKey);
  const [followToday, setFollowToday] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const boardRef = useRef<HTMLDivElement>(null);
  const canEditOrders = user?.role === Role.ADMIN || user?.permissionKeys?.includes(PermissionKey.PEDIDOS_EDITAR);
  const canAssignMotoboy = user?.role === Role.ADMIN || user?.permissionKeys?.includes(PermissionKey.ENTREGAS_EDITAR);

  useEffect(() => {
    const unlock = () => unlockNewOrderSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    const socket = connectSocket();
    const onCreated = () => {
      playNewOrderAlert(2);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders-pending-count"] });
    };
    socket.on("order.created", onCreated);

    return () => {
      socket.off("order.created", onCreated);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [queryClient]);

  useEffect(() => {
    const syncCalendarDay = () => {
      const nextToday = currentDateKey();
      setTodayDate((current) => {
        if (current !== nextToday && followToday) setSelectedDate(nextToday);
        return nextToday;
      });
    };
    const interval = window.setInterval(syncCalendarDay, 60_000);
    return () => window.clearInterval(interval);
  }, [followToday]);

  const { data, isLoading, error: ordersError } = useQuery({
    queryKey: ["orders", "kanban", selectedDate, search],
    queryFn: async () => {
      const { data } = await api.get<OrderFlowResponse>("/orders/flow", {
        params: { date: selectedDate, search: search || undefined },
      });
      return data;
    },
  });

  const orders = useMemo(() => data?.items ?? [], [data?.items]);
  const visibleOrders = useMemo(() => orders.filter((order) => fulfillmentFilter === "ALL" || (order.fulfillmentType ?? OrderFulfillmentType.DELIVERY) === fulfillmentFilter), [orders, fulfillmentFilter]);
  const draggedOrder = orders.find((order) => order.id === draggedId);
  const firstDate = data?.firstDate ?? selectedDate;
  const lastDate = data?.lastDate ?? todayDate;
  const isToday = selectedDate === lastDate;

  useEffect(() => {
    if (!data?.lastDate) return;
    setTodayDate(data.lastDate);
    if (followToday && selectedDate !== data.lastDate) {
      setSelectedDate(data.lastDate);
    }
  }, [data?.lastDate, followToday, selectedDate]);

  const { data: employees } = useQuery({
    queryKey: ["employees-motoboys-kanban"],
    queryFn: async () => {
      const { data } = await api.get<Employee[]>("/employees");
      return data;
    },
    enabled: user?.role === Role.ADMIN || user?.role === Role.FUNCIONARIO,
  });
  const motoboys = (employees ?? []).filter((employee) => employee.user.role === Role.MOTOBOY && employee.user.isActive);

  const updateStatus = useMutation({
    mutationFn: async ({ order, status }: { order: Order; status: OrderStatus }) => {
      const { data } = await api.patch<Order>(`/orders/${order.id}/status`, { status });
      return data;
    },
    onMutate: async ({ order, status }) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ["orders", "kanban"] });
      const previous = queryClient.getQueriesData<OrderFlowResponse>({ queryKey: ["orders", "kanban"] });
      queryClient.setQueriesData<OrderFlowResponse>({ queryKey: ["orders", "kanban"] }, (current) =>
        current
          ? { ...current, items: current.items.map((item) => (item.id === order.id ? { ...item, status } : item)) }
          : current,
      );
      return { previous };
    },
    onError: (err, _variables, context) => {
      context?.previous.forEach(([key, value]) => queryClient.setQueryData(key, value));
      setError(apiErrorMessage(err, "Não foi possível mover o pedido."));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders-today"] });
      queryClient.invalidateQueries({ queryKey: ["orders-pending-count"] });
    },
  });

  const assignMotoboy = useMutation({
    mutationFn: async ({ orderId, motoboyId }: { orderId: string; motoboyId: string }) => {
      await api.patch(`/deliveries/order/${orderId}/assign`, { motoboyId });
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    },
    onError: (err) => setError(apiErrorMessage(err, "Não foi possível atribuir o motoboy.")),
  });

  async function contactCustomer(orderId: string) {
    try {
      const { data } = await api.get<{ link: string }>(`/messaging/orders/${orderId}/whatsapp-link`);
      window.open(data.link, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(apiErrorMessage(err, "Não foi possível abrir o contato do cliente."));
    }
  }

  function canMove(order: Order | undefined, target: OrderStatus) {
    if (!canEditOrders) return false;
    if (!order || order.status === target || order.status === OrderStatus.ENTREGUE || order.status === OrderStatus.CANCELADO) return false;
    if (isPickupOrder(order) && target === OrderStatus.ENTREGUE && order.paymentStatus !== "PAGO") return false;
    if (target === OrderStatus.CANCELADO) return user?.role !== Role.COZINHA;
    if (user?.role === Role.COZINHA) {
      return (
        (order.status === OrderStatus.CONFIRMADO && target === OrderStatus.EM_PREPARO) ||
        (order.status === OrderStatus.EM_PREPARO && target === OrderStatus.PRONTO)
      );
    }
    const flow = isPickupOrder(order) ? ORDER_STATUS_FLOW.filter((status) => status !== OrderStatus.SAIU_PARA_ENTREGA) : ORDER_STATUS_FLOW;
    const currentIndex = flow.indexOf(order.status);
    return flow[currentIndex + 1] === target;
  }

  function handleDrop(target: OrderStatus) {
    if (draggedOrder && canMove(draggedOrder, target)) {
      updateStatus.mutate({ order: draggedOrder, status: target });
    } else if (draggedOrder && draggedOrder.status !== target) {
      setError(isPickupOrder(draggedOrder) && target === OrderStatus.ENTREGUE && draggedOrder.paymentStatus !== "PAGO"
        ? "Confirme o pagamento nos detalhes do pedido antes de marcar a retirada."
        : "Mova o pedido para a próxima etapa disponível. Etapas não podem ser puladas.");
    }
    setDraggedId(null);
    setOverStatus(null);
  }

  function selectDate(nextDate: string) {
    if (!nextDate || nextDate < firstDate || nextDate > lastDate) return;
    setSelectedDate(nextDate);
    setFollowToday(nextDate === lastDate);
    setDraggedId(null);
    setOverStatus(null);
    setError(null);
  }

  function moveDate(days: number) {
    selectDate(addDays(selectedDate, days));
  }

  const activeTotal = useMemo(
    () => orders.filter((order) => ![OrderStatus.ENTREGUE, OrderStatus.CANCELADO].includes(order.status)).length,
    [orders],
  );

  return (
    <div className="min-w-0 max-w-full space-y-5">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">
            {isToday ? "Operação em tempo real" : "Histórico diário"}
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-slate-100">Fluxo de pedidos</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isToday ? "Arraste cada pedido para a próxima etapa." : `Visualizando os pedidos iniciados em ${formatFlowDate(selectedDate)}.`}{" "}
            <strong className="text-slate-700 dark:text-slate-300">
              {activeTotal} {isToday ? "em andamento agora." : "ainda em andamento."}
            </strong>
          </p>
        </div>
        <label className="relative block w-full xl:w-80">
          <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-slate-400">🔎</span>
          <Input
            className="h-11 rounded-xl bg-white pl-10 shadow-sm dark:bg-slate-900"
            placeholder="Cliente ou número do pedido"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-700 dark:text-red-400">×</button>
        </div>
      )}

      {ordersError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300">
          {apiErrorMessage(ordersError, "Não foi possível carregar o fluxo de pedidos.")}
        </div>
      )}

      <section
        aria-label="Selecionar o dia do fluxo de pedidos"
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between dark:bg-slate-900 dark:border-slate-800"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300">
            <CalendarIcon />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">Dia do fluxo</h2>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
                isToday ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              }`}>
                {isToday ? "Hoje · ao vivo" : "Histórico"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Um dia por vez, de {formatShortDate(firstDate)} até {formatShortDate(lastDate)}.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Ver o dia anterior"
            disabled={selectedDate <= firstDate}
            onClick={() => moveDate(-1)}
            className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-xl font-black text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300"
          >
            ‹
          </button>
          <label className="relative min-w-[190px] flex-1 sm:flex-none">
            <span className="sr-only">Data do fluxo</span>
            <Input
              type="date"
              min={firstDate}
              max={lastDate}
              value={selectedDate}
              onChange={(event) => selectDate(event.target.value)}
              className="h-11 min-h-11 rounded-xl bg-slate-50 py-2 font-bold sm:w-[190px] dark:bg-slate-800/60"
            />
          </label>
          <button
            type="button"
            aria-label="Ver o próximo dia"
            disabled={selectedDate >= lastDate}
            onClick={() => moveDate(1)}
            className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-xl font-black text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300"
          >
            ›
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => selectDate(lastDate)}
              className="h-11 rounded-xl bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-brand-600"
            >
              Voltar para hoje
            </button>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-2" aria-label="Filtrar pedidos por modalidade">
        {([ ["ALL", "Todos"], [OrderFulfillmentType.DELIVERY, "Entrega"], [OrderFulfillmentType.PICKUP, "Retirada no local"] ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={fulfillmentFilter === value} onClick={() => setFulfillmentFilter(value)} className={`rounded-full border px-4 py-2 text-xs font-bold transition ${fulfillmentFilter === value ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{label} · {orders.filter((order) => value === "ALL" || (order.fulfillmentType ?? OrderFulfillmentType.DELIVERY) === value).length}</button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-slate-400">
          <span className="hidden sm:inline">Navegue pelas etapas do fluxo</span>
          <span className="sm:hidden">Deslize para ver as etapas</span>
        </p>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Ver etapas anteriores" onClick={() => boardRef.current?.scrollBy({ left: -BOARD_SCROLL_STEP, behavior: "smooth" })} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300">‹</button>
          <button type="button" aria-label="Ver próximas etapas" onClick={() => boardRef.current?.scrollBy({ left: BOARD_SCROLL_STEP, behavior: "smooth" })} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300">›</button>
        </div>
      </div>

      <div
        ref={boardRef}
        className="relative block w-full min-w-0 max-w-full snap-x snap-proximity touch-pan-x overflow-x-auto overscroll-x-contain pb-5 [contain:inline-size] [scrollbar-color:#94a3b8_transparent] [scrollbar-gutter:stable]"
      >
        <div className="flex w-max min-w-full gap-4 pr-1">
          {COLUMNS.map((column) => {
            const columnOrders = visibleOrders.filter((order) => order.status === column.status);
            const validTarget = canMove(draggedOrder, column.status);
            return (
              <section
                key={column.status}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOverStatus(column.status);
                }}
                onDragLeave={() => setOverStatus((current) => (current === column.status ? null : current))}
                onDrop={() => handleDrop(column.status)}
                className={`flex h-[620px] w-[calc(100vw_-_1.5rem)] max-w-96 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border shadow-[0_18px_45px_-34px_rgba(15,23,42,.55)] transition-all duration-200 sm:h-[660px] sm:w-96 ${column.surface} ${column.border} ${
                  overStatus === column.status && validTarget ? "scale-[1.01] ring-4 ring-brand-200 shadow-xl" : ""
                } ${draggedId && !validTarget && draggedOrder?.status !== column.status ? "opacity-55" : ""}`}
              >
                <header className={`flex items-center justify-between px-4 py-3.5 text-white ${column.header}`}>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,.18)] dark:bg-slate-900" />
                    <h2 className="text-sm font-black">{fulfillmentFilter === OrderFulfillmentType.PICKUP && column.status === OrderStatus.ENTREGUE ? "Retirados" : column.title}</h2>
                  </div>
                  <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/20 px-2 text-xs font-black text-white ring-1 ring-white/25">
                    {columnOrders.length}
                  </span>
                </header>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain p-3">
                  {columnOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      dragging={draggedId === order.id}
                      draggable={Boolean(canEditOrders && !updateStatus.isPending && ![OrderStatus.ENTREGUE, OrderStatus.CANCELADO].includes(order.status))}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", order.id);
                        setDraggedId(order.id);
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setOverStatus(null);
                      }}
                      accent={column.accent}
                      motoboys={motoboys}
                      canAssign={Boolean(canAssignMotoboy)}
                      assigning={assignMotoboy.isPending}
                      onAssign={(motoboyId) => assignMotoboy.mutate({ orderId: order.id, motoboyId })}
                      onContact={() => contactCustomer(order.id)}
                    />
                  ))}
                  {!isLoading && columnOrders.length === 0 && (
                    <div className={`grid min-h-28 place-items-center rounded-xl border border-dashed ${column.border} bg-white/70 px-4 text-center text-xs font-medium text-slate-500 dark:bg-slate-950/55 dark:text-slate-400`}>
                      {draggedId && validTarget ? `Solte para mover para ${column.shortTitle}` : "Nenhum pedido nesta etapa"}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OrderCard({
  order,
  dragging,
  draggable,
  onDragStart,
  onDragEnd,
  accent,
  motoboys,
  canAssign,
  assigning,
  onAssign,
  onContact,
}: {
  order: Order;
  dragging: boolean;
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  accent: string;
  motoboys: Employee[];
  canAssign: boolean;
  assigning: boolean;
  onAssign: (motoboyId: string) => void;
  onContact: () => void;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 pt-4 shadow-[0_14px_32px_-22px_rgba(15,23,42,.55)] transition-all duration-200 dark:border-slate-700 dark:bg-slate-950 dark:shadow-[0_14px_32px_-22px_rgba(0,0,0,.8)] ${
        draggable ? "cursor-grab hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing" : ""
      } ${dragging ? "scale-95 rotate-1 opacity-40" : "opacity-100"}`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${accent}`} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-brand-600">#{order.id.slice(0, 7)}</p>
          <h3 className="mt-1 line-clamp-1 font-black text-slate-950 dark:text-slate-100">{order.customer?.name ?? order.customerName ?? "Cliente"}</h3>
          {order.source === "WHATSAPP" && <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">WhatsApp IA</span>}
          {order.fulfillmentType === OrderFulfillmentType.PICKUP && <span className="mt-1 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-800 dark:bg-violet-950/50 dark:text-violet-200">Retirada no local</span>}
        </div>
        {draggable && <span className="select-none text-lg leading-none text-slate-300 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-300" title="Arrastar">⠿</span>}
      </div>

      <div className="my-3 space-y-1.5 border-y border-slate-100 py-3 dark:border-slate-800">
        {order.items.slice(0, 2).map((item) => (
          <p key={item.id} className="line-clamp-1 text-xs text-slate-600 dark:text-slate-400">
            <strong>{item.quantity}×</strong> {item.productName}
          </p>
        ))}
        {order.items.length > 2 && <p className="text-[11px] font-bold text-slate-400">+ {order.items.length - 2} outro(s) item(ns)</p>}
      </div>

      {canAssign && !isPickupOrder(order) && ![OrderStatus.ENTREGUE, OrderStatus.CANCELADO].includes(order.status) && (
        <label className="mb-3 block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
            <DeliveryIcon /> Entregador
          </span>
          <select
            value={order.delivery?.motoboyId ?? ""}
            disabled={assigning}
            onChange={(event) => event.target.value && onAssign(event.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:bg-slate-950"
          >
            <option value="">Selecionar motoboy...</option>
            {motoboys.map((motoboy) => (
              <option key={motoboy.id} value={motoboy.user.id}>{motoboy.user.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-base font-black text-slate-950 dark:text-slate-100">{formatCurrency(Number(order.total))}</p>
          <p className="text-[10px] font-medium text-slate-400">{formatDateTime(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            draggable={false}
            onClick={onContact}
            title="Falar com o cliente"
            className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-700 transition hover:bg-emerald-600 hover:text-white dark:bg-emerald-950/45 dark:text-emerald-300 dark:hover:bg-emerald-600"
          >
            <WhatsappIcon />
          </button>
          <Link
            href={`/painel/pedidos/${order.id}`}
            draggable={false}
            className="rounded-lg bg-slate-950 px-3 py-2.5 text-xs font-black text-white transition hover:bg-brand-600"
          >
            Detalhes
          </Link>
        </div>
      </div>
    </article>
  );
}

function DeliveryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
      <path d="M3 17h2l2-5h8l3 5h3M7 12l2-5h5l1 5M7 19a2 2 0 1 0 0 .01M18 19a2 2 0 1 0 0 .01" />
    </svg>
  );
}

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-[18px] w-[18px]">
      <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.5Z" />
      <path d="M9 8.5c.4 2.6 1.9 4.1 4.5 4.8M14 13.3l1.2-1M9 8.5 10 7.4" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
      <path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
      <path d="M8 12h3M8 16h3M14 12h2M14 16h2" />
    </svg>
  );
}

function currentDateKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function formatFlowDate(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00`));
}

function formatShortDate(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${dateKey}T12:00:00`));
}
