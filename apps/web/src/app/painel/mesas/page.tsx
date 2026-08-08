"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { DiningOrderSource, DiningOrderStatus, PaymentMethod, PermissionKey, Role, TableStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { connectSocket } from "@/lib/socket-client";
import { formatCurrency } from "@/lib/format";
import { useAuthStore } from "@/lib/auth-store";
import { Paginated, Product } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import { MaskedInput } from "@/components/ui/brazil-fields";
import { Modal } from "@/components/ui/modal";
import { WaiterAssistant } from "@/components/ai/waiter-assistant";
import { TableQrCode } from "@/components/tables/table-qr-code";

interface DiningOrder {
  id: string;
  status: DiningOrderStatus;
  subtotal: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  source: DiningOrderSource;
  createdBy?: { id: string; name: string } | null;
  items: Array<{ id: string; productName: string; quantity: number; totalPrice: number; notes?: string | null }>;
}

interface TableSession {
  id: string;
  customerName?: string | null;
  customerPhone?: string | null;
  guestCount: number;
  notes?: string | null;
  openedAt: string;
  openedFromQr: boolean;
  openedBy?: { id: string; name: string } | null;
  attendantUserId?: string | null;
  attendant?: { id: string; name: string } | null;
  orders: DiningOrder[];
}

interface RestaurantTable {
  id: string;
  name: string;
  seats: number;
  area?: string | null;
  status: TableStatus;
  session: TableSession | null;
  metrics: {
    total: number;
    activeOrderCount: number;
    occupiedMinutes: number;
    minutesWithoutOrder: number | null;
    mostDelayedOrderMinutes: number | null;
  } | null;
}

function useTableAction(request: () => Promise<unknown>, setError: (message: string | null) => void, success?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["tables-overview"] });
      success?.();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });
}

const ORDER_FLOW = [
  DiningOrderStatus.RECEBIDO,
  DiningOrderStatus.EM_PREPARO,
  DiningOrderStatus.PRONTO,
  DiningOrderStatus.SERVIDO,
];

const ORDER_LABEL: Record<DiningOrderStatus, string> = {
  RECEBIDO: "Recebido",
  EM_PREPARO: "Em preparo",
  PRONTO: "Pronto",
  SERVIDO: "Servido",
  CANCELADO: "Cancelado",
};

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  [PaymentMethod.DINHEIRO]: "Dinheiro",
  [PaymentMethod.CARTAO_ENTREGA]: "Cartão",
  [PaymentMethod.PIX_MANUAL]: "Pix",
};

export default function MesasPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [filter, setFilter] = useState<"TODAS" | TableStatus>("TODAS");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tableForm, setTableForm] = useState({ name: "", seats: "4", area: "Salão principal" });
  const [openForm, setOpenForm] = useState({ customerName: "", customerPhone: "", guestCount: "2", notes: "" });
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orderNotes, setOrderNotes] = useState("");
  const [closeForm, setCloseForm] = useState({ paymentMethod: PaymentMethod.DINHEIRO, customerDocument: "" });

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ["tables-overview"],
    queryFn: async () => (await api.get<RestaurantTable[]>("/tables/overview")).data,
    refetchInterval: 15000,
  });
  const isWaiter = user?.role === Role.GARCOM;
  const hasPermission = (permission: PermissionKey) =>
    user?.role === Role.ADMIN || user?.role === Role.SUPER_ADMIN || user?.permissionKeys?.includes(permission);
  const canReadMenu = Boolean(hasPermission(PermissionKey.CARDAPIO_VISUALIZAR));
  const canOperateTables = Boolean(hasPermission(PermissionKey.MESAS_OPERAR));
  const canOpenOrOrder = canOperateTables;
  const canAdvanceOrder = (next: DiningOrderStatus) => {
    if (!canOperateTables || !user) return false;
    if (user.role === Role.GARCOM) return next === DiningOrderStatus.SERVIDO;
    return [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA].includes(user.role);
  };

  const { data: productsData } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => (await api.get<Paginated<Product>>("/catalog/products", { params: { pageSize: 100 } })).data,
    enabled: canReadMenu,
  });
  const { data: qrData, isLoading: isLoadingQr } = useQuery({
    queryKey: ["table-qr", selectedId],
    queryFn: async () => (await api.get<{ id: string; name: string; qrToken: string }>(`/tables/${selectedId}/qr`)).data,
    enabled: Boolean(qrOpen && selectedId && user?.role === Role.ADMIN),
  });
  const products = productsData?.items.filter((product) => product.isActive) ?? [];
  const selected = tables.find((table) => table.id === selectedId) ?? null;

  useEffect(() => {
    setOrigin(window.location.origin);
    const socket = connectSocket();
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["tables-overview"] });
    ["table.changed", "table.opened", "table.attendant_assigned", "table.closed", "table.order_created", "table.order_status_changed"].forEach((event) =>
      socket.on(event, refresh),
    );
    return () => {
      ["table.changed", "table.opened", "table.attendant_assigned", "table.closed", "table.order_created", "table.order_status_changed"].forEach((event) =>
        socket.off(event, refresh),
      );
    };
  }, [queryClient]);

  const createTable = useTableAction(
    () => api.post("/tables", { name: tableForm.name, seats: Number(tableForm.seats), area: tableForm.area || undefined }),
    setError,
    () => {
      setCreateOpen(false);
      setTableForm({ name: "", seats: "4", area: "Salão principal" });
    },
  );
  const openTable = useTableAction(
    () =>
      api.post(`/tables/${selectedId}/open`, {
        customerName: openForm.customerName || undefined,
        customerPhone: openForm.customerPhone || undefined,
        guestCount: Number(openForm.guestCount),
        notes: openForm.notes || undefined,
      }),
    setError,
    () => setOpenForm({ customerName: "", customerPhone: "", guestCount: "2", notes: "" }),
  );
  const closeTable = useTableAction(
    () => api.post(`/tables/${selectedId}/close`, {
      paymentMethod: closeForm.paymentMethod,
      customerDocument: closeForm.customerDocument.trim() || undefined,
    }),
    setError,
    () => {
      setCloseOpen(false);
      setCloseForm({ paymentMethod: PaymentMethod.DINHEIRO, customerDocument: "" });
    },
  );
  const assumeTable = useTableAction(() => api.post(`/tables/${selectedId}/assume`), setError);
  const rotateQr = useTableAction(
    () => api.post(`/tables/${selectedId}/qr/rotate`),
    setError,
    () => queryClient.invalidateQueries({ queryKey: ["table-qr", selectedId] }),
  );
  const changeTable = useTableAction(
    () => api.patch(`/tables/${selectedId}`, { status: selected?.status === TableStatus.INATIVA ? TableStatus.LIVRE : TableStatus.INATIVA }),
    setError,
  );
  const addOrder = useTableAction(
    () =>
      api.post(`/tables/${selectedId}/orders`, {
        items: Object.entries(cart)
          .filter(([, quantity]) => quantity > 0)
          .map(([productId, quantity]) => ({ productId, quantity })),
        notes: orderNotes || undefined,
      }),
    setError,
    () => {
      setOrderOpen(false);
      setCart({});
      setOrderNotes("");
    },
  );
  const updateOrder = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DiningOrderStatus }) =>
      api.patch(`/tables/orders/${id}/status`, { status }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["tables-overview"] });
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const counts = {
    free: tables.filter((table) => table.status === TableStatus.LIVRE).length,
    occupied: tables.filter((table) => table.status === TableStatus.OCUPADA).length,
    attention: tables.filter((table) => attentionLevel(table) === "danger").length,
    revenue: tables.reduce((sum, table) => sum + (table.metrics?.total ?? 0), 0),
  };
  const visible = tables.filter((table) => filter === "TODAS" || table.status === filter);
  const filteredProducts = products.filter((product) => normalize(product.name).includes(normalize(search)));
  const cartTotal = Object.entries(cart).reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + (product ? Number(product.price) * quantity : 0);
  }, 0);
  const canCloseSelected = Boolean(canOpenOrOrder && selected?.session?.attendantUserId === user?.id);
  const qrUrl = qrData?.qrToken && origin ? `${origin}/mesa/${qrData.qrToken}` : "";

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-7 text-white shadow-2xl sm:px-8">
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-brand-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Salão em tempo real
            </span>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Mesas e comandas</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              {isWaiter
                ? "Acompanhe suas comandas, lance rodadas e confirme quando cada pedido for servido."
                : "Veja o ritmo do salão, antecipe esperas e acompanhe cada rodada do pedido até servir."}
            </p>
          </div>
          {user?.role === Role.ADMIN && <Button onClick={() => setCreateOpen(true)} className="bg-brand-500 hover:bg-brand-400">+ Nova mesa</Button>}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Mesas livres" value={counts.free} detail={`de ${tables.length} cadastradas`} tone="emerald" />
        <Metric label="Em atendimento" value={counts.occupied} detail="comandas abertas" tone="brand" />
        <Metric label="Pedem atenção" value={counts.attention} detail="espera acima do ideal" tone="rose" />
        <Metric label="Consumo em aberto" value={formatCurrency(counts.revenue)} detail="total das mesas ocupadas" tone="amber" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["TODAS", TableStatus.LIVRE, TableStatus.OCUPADA, TableStatus.RESERVADA, TableStatus.INATIVA] as const).map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={clsx(
              "shrink-0 rounded-full px-4 py-2 text-xs font-black transition",
              filter === value ? "bg-slate-950 text-white shadow-lg" : "border border-slate-200 bg-white text-slate-600 hover:border-brand-300 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400",
            )}
          >
            {value === "TODAS" ? "Todas" : tableStatusLabel(value)}
          </button>
        ))}
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:border-rose-900/60 dark:text-rose-300">{error}</div>}
      {isLoading && <div className="rounded-3xl bg-white p-10 text-center text-slate-500 dark:bg-slate-900 dark:text-slate-400">Organizando o salão...</div>}
      {!isLoading && !visible.length && (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:bg-slate-900 dark:border-slate-700">
          <p className="text-lg font-black text-slate-900 dark:text-slate-100">Nenhuma mesa aqui ainda</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Cadastre as mesas e organize por área para começar.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((table) => <TableCard key={table.id} table={table} onClick={() => setSelectedId(table.id)} />)}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Cadastrar uma mesa">
        <div className="space-y-4">
          <FormField label="Identificação"><Input placeholder="Ex.: Mesa 08" value={tableForm.name} onChange={(e) => setTableForm({ ...tableForm, name: e.target.value })} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Lugares"><Input type="number" min={1} max={30} value={tableForm.seats} onChange={(e) => setTableForm({ ...tableForm, seats: e.target.value })} /></FormField>
            <FormField label="Área"><Input placeholder="Varanda" value={tableForm.area} onChange={(e) => setTableForm({ ...tableForm, area: e.target.value })} /></FormField>
          </div>
          <Button className="w-full" disabled={!tableForm.name.trim()} isLoading={createTable.isPending} onClick={() => createTable.mutate()}>Cadastrar mesa</Button>
        </div>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected ? `${selected.name} · ${tableStatusLabel(selected.status)}` : "Mesa"}>
        {selected && (
          <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
            {user?.role === Role.ADMIN && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                <div><p className="text-sm font-black text-slate-900 dark:text-slate-100">QR de pedido da mesa</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Cardápio restrito à {selected.name}, sem acesso ao painel.</p></div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setQrOpen(true)}>Ver QR</Button>
              </div>
            )}
            {selected.status === TableStatus.LIVRE || selected.status === TableStatus.RESERVADA ? (
              canOpenOrOrder ? <>
                <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
                  <p className="font-black text-emerald-900 dark:text-emerald-200">Pronta para receber</p>
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">{selected.seats} lugares · {selected.area || "Sem área definida"}</p>
                </div>
                <FormField label="Nome do cliente (opcional)"><Input placeholder="Como podemos chamar?" value={openForm.customerName} onChange={(e) => setOpenForm({ ...openForm, customerName: e.target.value })} /></FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Telefone (opcional)"><MaskedInput mask="phone" placeholder="(11) 99999-9999" value={openForm.customerPhone} onChange={(e) => setOpenForm({ ...openForm, customerPhone: e.target.value })} /></FormField>
                  <FormField label="Pessoas"><Input type="number" min={1} max={selected.seats} value={openForm.guestCount} onChange={(e) => setOpenForm({ ...openForm, guestCount: e.target.value })} /></FormField>
                </div>
                <FormField label="Observação"><Textarea placeholder="Aniversário, cadeira infantil..." value={openForm.notes} onChange={(e) => setOpenForm({ ...openForm, notes: e.target.value })} /></FormField>
                <Button className="w-full" isLoading={openTable.isPending} onClick={() => openTable.mutate()}>Abrir atendimento</Button>
              </> : <div className="rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">A equipe do salão abre a mesa. A cozinha acompanha os pedidos assim que forem lançados.</div>
            ) : selected.status === TableStatus.OCUPADA && selected.session ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Info label="Cliente" value={selected.session.customerName || "Consumidor local"} />
                  <Info label="Pessoas" value={`${selected.session.guestCount}`} />
                  <Info label="Aberta há" value={humanMinutes(selected.metrics?.occupiedMinutes ?? 0)} />
                  <Info label="Comanda" value={formatCurrency(selected.metrics?.total ?? 0)} />
                </div>
                <div className={clsx("rounded-2xl border p-3", selected.session.attendant ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30" : "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30")}>
                  {selected.session.attendant ? <><p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Atendimento assumido</p><p className="mt-1 text-sm font-bold text-emerald-950 dark:text-emerald-100">{selected.session.attendant.name} é quem pode encerrar esta mesa.</p></> : <><p className="text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">Aguardando equipe</p><p className="mt-1 text-sm font-bold text-amber-950 dark:text-amber-100">Esta comanda foi aberta pelo QR. Assuma o atendimento antes de fechar.</p>{canOpenOrOrder && <Button size="sm" className="mt-3" isLoading={assumeTable.isPending} onClick={() => assumeTable.mutate()}>Assumir atendimento</Button>}</>}
                </div>
                {canOpenOrOrder && canReadMenu && <Button className="w-full" onClick={() => setOrderOpen(true)}>+ Lançar nova rodada</Button>}
                <div className="space-y-3">
                  {selected.session.orders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      canAdvance={canAdvanceOrder}
                      onStatus={(status) => updateOrder.mutate({ id: order.id, status })}
                    />
                  ))}
                  {!selected.session.orders.length && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-300">A mesa ainda não fez nenhum pedido.</div>}
                </div>
                {canCloseSelected ? <Button variant="outline" className="w-full" onClick={() => setCloseOpen(true)}>Fechar mesa e registrar pagamento</Button> : canOpenOrOrder && selected.session.attendant && <p className="rounded-2xl bg-slate-100 p-3 text-center text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">Somente {selected.session.attendant.name} pode fechar esta mesa.</p>}
              </>
            ) : (
              <div className="space-y-3">
                <p className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-400">Essa mesa está fora da operação.</p>
                {user?.role === Role.ADMIN && <Button className="w-full" onClick={() => changeTable.mutate()}>Reativar mesa</Button>}
              </div>
            )}
            {user?.role === Role.ADMIN && selected.status === TableStatus.LIVRE && (
              <button onClick={() => changeTable.mutate()} className="w-full py-2 text-xs font-bold text-slate-400 hover:text-rose-600 dark:text-rose-400">Desativar esta mesa</button>
            )}
          </div>
        )}
      </Modal>

      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title={`Finalizar atendimento · ${selected?.name ?? "Mesa"}`}>
        <div className="space-y-5">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900/60 dark:bg-brand-950/30">
            <p className="text-sm font-black text-brand-950 dark:text-brand-100">Comanda de {formatCurrency(selected?.metrics?.total ?? 0)}</p>
            <p className="mt-1 text-xs leading-5 text-brand-800 dark:text-brand-200">Registre o recebimento real. Essa informação segue para a NFC-e da mesa e evita que o sistema suponha uma forma de pagamento.</p>
          </div>
          <FormField label="Forma de pagamento">
            <Select value={closeForm.paymentMethod} onChange={(event) => setCloseForm({ ...closeForm, paymentMethod: event.target.value as PaymentMethod })}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </FormField>
          <FormField label="CPF/CNPJ na nota (opcional)">
            <Input inputMode="numeric" placeholder="Somente se o cliente solicitar identificação" value={closeForm.customerDocument} onChange={(event) => setCloseForm({ ...closeForm, customerDocument: event.target.value })} />
          </FormField>
          <p className="rounded-2xl bg-slate-100 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">Se a emissão automática estiver ativa, a NFC-e é solicitada após liberar a mesa. Em homologação, o cupom sai identificado como <b>sem valor fiscal</b>; em produção, segue para a SEFAZ.</p>
          <Button className="w-full" isLoading={closeTable.isPending} onClick={() => closeTable.mutate()}>Confirmar pagamento e fechar mesa</Button>
        </div>
      </Modal>

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title={`QR Code · ${selected?.name ?? "Mesa"}`}>
        {selected && (isLoadingQr || !qrUrl ? <div className="rounded-2xl bg-slate-100 p-8 text-center text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">Preparando QR Code…</div> : <div className="space-y-4"><TableQrCode url={qrUrl} tableName={selected.name} /><div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">Se uma impressão for perdida ou substituída, gere um QR novo. O anterior deixa de funcionar imediatamente.</div><Button type="button" variant="outline" className="w-full" isLoading={rotateQr.isPending} onClick={() => rotateQr.mutate()}>Gerar um novo QR e invalidar o anterior</Button></div>)}
      </Modal>

      <Modal open={orderOpen} onClose={() => setOrderOpen(false)} title={`Novo pedido · ${selected?.name ?? ""}`}>
        <div className="space-y-4">
          <Input placeholder="Buscar no cardápio..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            {filteredProducts.map((product) => {
              const quantity = cart[product.id] ?? 0;
              return (
                <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{product.name}</p>
                    <p className="text-xs font-bold text-brand-700 dark:text-brand-300">{formatCurrency(Number(product.price))}</p>
                  </div>
                  <button className="h-8 w-8 rounded-full bg-slate-100 font-black dark:bg-slate-800" onClick={() => setCart({ ...cart, [product.id]: Math.max(0, quantity - 1) })}>−</button>
                  <span className="w-5 text-center text-sm font-black">{quantity}</span>
                  <button className="h-8 w-8 rounded-full bg-brand-600 font-black text-white" onClick={() => setCart({ ...cart, [product.id]: quantity + 1 })}>+</button>
                </div>
              );
            })}
          </div>
          <Textarea placeholder="Observação geral da rodada..." value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
          <Button className="w-full justify-between" disabled={!Object.values(cart).some(Boolean)} isLoading={addOrder.isPending} onClick={() => addOrder.mutate()}>
            <span>Enviar para produção</span><span>{formatCurrency(cartTotal)}</span>
          </Button>
        </div>
      </Modal>
      {isWaiter && <WaiterAssistant />}
    </div>
  );
}

function TableCard({ table, onClick }: { table: RestaurantTable; onClick: () => void }) {
  const attention = attentionLevel(table);
  return (
    <button onClick={onClick} className={clsx("group relative min-h-56 overflow-hidden rounded-[26px] border p-5 text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl", tableCardTone(table.status))}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-60">{table.area || "Salão"}</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">{table.name}</h2>
        </div>
        <span className="rounded-full border border-slate-900/10 bg-white px-2.5 py-1 text-[10px] font-black uppercase shadow-sm dark:border-white/15 dark:bg-slate-800">{tableStatusLabel(table.status)}</span>
      </div>
      {table.session ? (
        <div className="mt-6">
          <p className="truncate text-sm font-black">{table.session.customerName || "Consumidor local"} · {table.session.guestCount} pessoas</p>
          <p className="mt-1 text-xs opacity-70">Atendimento há {humanMinutes(table.metrics?.occupiedMinutes ?? 0)}</p>
          <div className="mt-5 flex items-end justify-between">
            <div><p className="text-[10px] font-bold uppercase opacity-60">Comanda</p><p className="text-xl font-black">{formatCurrency(table.metrics?.total ?? 0)}</p></div>
            <div className="text-right"><p className="text-[10px] font-bold uppercase opacity-60">Pedidos ativos</p><p className="text-xl font-black">{table.metrics?.activeOrderCount ?? 0}</p></div>
          </div>
          {attention !== "none" && <div className={clsx("mt-4 rounded-xl px-3 py-2 text-xs font-black", attention === "danger" ? "bg-rose-600 text-white" : "bg-amber-400 text-amber-950")}>{attentionText(table)}</div>}
        </div>
      ) : (
        <div className="mt-10">
          {/*
            Era o caractere `⌑` (U+2311). Quase nenhuma fonte tem esse glifo,
            então o navegador desenhava o retângulo de "caractere ausente". SVG
            não depende de fonte instalada.
          */}
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-900/10 bg-white shadow-sm dark:border-white/15 dark:bg-slate-800">
            <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6 opacity-70" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="6.5" />
              <path d="M4 12h1.5M18.5 12H20M12 4v1.5M12 18.5V20" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-bold opacity-70">{table.seats} lugares · toque para {table.status === TableStatus.INATIVA ? "gerenciar" : "abrir"}</p>
        </div>
      )}
    </button>
  );
}

function OrderRow({
  order,
  onStatus,
  canAdvance,
}: {
  order: DiningOrder;
  onStatus: (status: DiningOrderStatus) => void;
  canAdvance: (status: DiningOrderStatus) => boolean;
}) {
  const next = ORDER_FLOW[ORDER_FLOW.indexOf(order.status) + 1];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-wide text-brand-700 dark:text-brand-300">{ORDER_LABEL[order.status]}</p><p className="text-xs text-slate-400">{timeAgo(order.createdAt)} · {order.source === DiningOrderSource.QR_MESA ? "pedido pelo QR da mesa" : `por ${order.createdBy?.name ?? "equipe"}`}</p></div>
        <p className="font-black">{formatCurrency(Number(order.subtotal))}</p>
      </div>
      <div className="my-3 space-y-1">{order.items.map((item) => <p key={item.id} className="text-sm text-slate-700 dark:text-slate-300"><b>{item.quantity}×</b> {item.productName}{item.notes && <span className="block pl-5 text-xs text-slate-400">{item.notes}</span>}</p>)}</div>
      {next && canAdvance(next) && <Button size="sm" className="w-full" onClick={() => onStatus(next)}>Marcar como {ORDER_LABEL[next].toLowerCase()}</Button>}
    </div>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: "emerald" | "brand" | "rose" | "amber" }) {
  // As paradas do gradiente e o `bg-gradient-to-br` viviam em literais
  // separados, então o verificador de tema não conseguia relacionar os dois e
  // o cartão seguiu claro no escuro. Agora cada tom traz o gradiente inteiro,
  // com as duas versões.
  const tones = {
    emerald: "bg-gradient-to-br from-emerald-50 to-white text-emerald-700 dark:from-emerald-950/40 dark:to-slate-900 dark:text-emerald-300",
    brand: "bg-gradient-to-br from-orange-50 to-white text-brand-700 dark:from-brand-950/40 dark:to-slate-900 dark:text-brand-300",
    rose: "bg-gradient-to-br from-rose-50 to-white text-rose-700 dark:from-rose-950/40 dark:to-slate-900 dark:text-rose-300",
    amber: "bg-gradient-to-br from-amber-50 to-white text-amber-700 dark:from-amber-950/40 dark:to-slate-900 dark:text-amber-300",
  };
  return <div className={clsx("rounded-2xl border border-slate-200 p-4 shadow-sm dark:border-slate-800", tones[tone])}><p className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">{label}</p><p className="mt-2 text-2xl font-black tracking-tight">{value}</p><p className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">{detail}</p></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-100 p-3 dark:bg-slate-800"><p className="text-[10px] font-black uppercase text-slate-400">{label}</p><p className="mt-1 truncate text-sm font-black text-slate-900 dark:text-slate-100">{value}</p></div>;
}

function attentionLevel(table: RestaurantTable): "none" | "warning" | "danger" {
  if (table.status !== TableStatus.OCUPADA || !table.metrics) return "none";
  if ((table.metrics.minutesWithoutOrder ?? 0) >= 15 || (table.metrics.mostDelayedOrderMinutes ?? 0) >= 20) return "danger";
  if ((table.metrics.minutesWithoutOrder ?? 0) >= 8 || (table.metrics.mostDelayedOrderMinutes ?? 0) >= 12) return "warning";
  return "none";
}

function attentionText(table: RestaurantTable) {
  if ((table.metrics?.minutesWithoutOrder ?? 0) >= 8) return `Sem pedido há ${table.metrics?.minutesWithoutOrder} min`;
  return `Pedido aguardando há ${table.metrics?.mostDelayedOrderMinutes} min`;
}

function tableCardTone(status: TableStatus) {
  if (status === TableStatus.OCUPADA) return "border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 text-slate-950 dark:border-orange-900/60 dark:from-orange-950/40 dark:via-slate-900 dark:to-amber-950/30 dark:text-slate-100";
  if (status === TableStatus.LIVRE) return "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 text-slate-950 dark:border-emerald-900/60 dark:from-emerald-950/40 dark:via-slate-900 dark:to-teal-950/30 dark:text-slate-100";
  if (status === TableStatus.RESERVADA) return "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 text-slate-950 dark:border-violet-900/60 dark:from-violet-950/40 dark:via-slate-900 dark:to-indigo-950/30 dark:text-slate-100";
  return "border-slate-200 bg-slate-100 text-slate-500 opacity-75 dark:bg-slate-800 dark:border-slate-800 dark:text-slate-400";
}

function tableStatusLabel(status: TableStatus) {
  return { LIVRE: "Livre", OCUPADA: "Em uso", RESERVADA: "Reservada", INATIVA: "Inativa" }[status];
}

function humanMinutes(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function timeAgo(date: string) {
  return humanMinutes(Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000)));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
