"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PermissionKey,
  Role,
  WhatsAppConversationMode,
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
} from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { MessagingChannel, WhatsAppConversation, WhatsAppConversationDetail } from "@/lib/types";
import { connectSocket } from "@/lib/socket-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const MODE_LABEL: Record<WhatsAppConversationMode, string> = {
  [WhatsAppConversationMode.VIRTUAL]: "Atendente virtual",
  [WhatsAppConversationMode.HUMANO]: "Atendimento humano",
};
const STATUS_LABEL: Record<WhatsAppConversationStatus, string> = {
  [WhatsAppConversationStatus.ABERTA]: "Aberta",
  [WhatsAppConversationStatus.ENCERRADA]: "Encerrada",
};

export default function AtendimentoPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === Role.ADMIN;
  const canEditSupport = isAdmin || user?.permissionKeys?.includes(PermissionKey.PEDIDOS_EDITAR);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const { data: channel } = useQuery({
    queryKey: ["messaging-channel"],
    queryFn: async () => (await api.get<MessagingChannel>("/messaging/channel")).data,
    enabled: isAdmin,
  });
  const { data: conversations = [], isLoading: loadingList } = useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: async () => (await api.get<WhatsAppConversation[]>("/messaging/conversations")).data,
    refetchInterval: 20_000,
  });
  const { data: conversation, isLoading: loadingConversation } = useQuery({
    queryKey: ["whatsapp-conversation", selectedId],
    queryFn: async () => (await api.get<WhatsAppConversationDetail>(`/messaging/conversations/${selectedId}`)).data,
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!conversations.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !conversations.some((item) => item.id === selectedId)) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  useEffect(() => {
    const socket = connectSocket();
    const refreshList = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    const refreshSelected = (payload?: { conversationId?: string }) => {
      if (!payload?.conversationId || payload.conversationId === selectedId) {
        queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation", selectedId] });
      }
      refreshList();
    };
    socket.on("whatsapp.message.received", refreshSelected);
    socket.on("whatsapp.message.sent", refreshSelected);
    socket.on("whatsapp.conversation.updated", refreshSelected);
    socket.on("whatsapp.order_draft_updated", refreshSelected);
    return () => {
      socket.off("whatsapp.message.received", refreshSelected);
      socket.off("whatsapp.message.sent", refreshSelected);
      socket.off("whatsapp.conversation.updated", refreshSelected);
      socket.off("whatsapp.order_draft_updated", refreshSelected);
    };
  }, [queryClient, selectedId]);

  const updateConversation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      if (!selectedId) throw new Error("Selecione uma conversa.");
      return (await api.patch(`/messaging/conversations/${selectedId}`, data)).data;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation", selectedId] });
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedId) throw new Error("Selecione uma conversa.");
      return (await api.post(`/messaging/conversations/${selectedId}/messages`, { content })).data;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation", selectedId] });
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const clearConversation = useMutation({
    mutationFn: async (conversationId: string) => {
      return (await api.delete(`/messaging/conversations/${conversationId}/messages`)).data;
    },
    onSuccess: () => {
      setClearDialogOpen(false);
      setDraft("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation", selectedId] });
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [selectedId, conversation?.messages.length, loadingConversation, sendMessage.isPending]);

  useEffect(() => {
    setClearDialogOpen(false);
  }, [selectedId]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 rounded-[30px] bg-slate-950 p-6 text-white shadow-xl lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">WhatsApp Business</p>
          <h1 className="mt-2 text-3xl font-black">Central de atendimento</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Acompanhe conversas do número desta empresa, assuma atendimentos humanos e deixe a IA cuidar apenas das conversas autorizadas pelo cliente.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && <span className={`rounded-full px-3 py-1.5 text-xs font-black ${channel?.connected ? "bg-emerald-400/20 text-emerald-200" : "bg-amber-400/20 text-amber-100"}`}>
            {channel?.connected ? "Canal conectado" : "Canal não conectado"}
          </span>}
          {isAdmin && <Link href="/painel/configuracoes" className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-emerald-50 dark:bg-slate-100 dark:hover:bg-white">Configurar WhatsApp</Link>}
        </div>
      </header>

      {isAdmin && !channel?.connected && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-200">
          Ainda não há um número Meta conectado. Vincule o Phone Number ID e o token da empresa em Configurações para receber conversas aqui.
        </div>
      )}
      {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}

      <div className="grid min-h-[680px] gap-5 xl:h-[calc(100dvh-23rem)] xl:min-h-[560px] xl:max-h-[720px] xl:grid-cols-[320px_minmax(0,1fr)_280px]">
        <ConversationList conversations={conversations} selectedId={selectedId} loading={loadingList} onSelect={setSelectedId} />

        <Card className="min-h-[620px] overflow-hidden xl:h-full xl:min-h-0">
          {!conversation && !loadingConversation ? (
            <EmptyConversation connected={isAdmin ? Boolean(channel?.connected) : true} canConfigure={Boolean(isAdmin)} />
          ) : (
            <div className="flex h-full min-h-[620px] flex-col xl:min-h-0">
              <ConversationHeader
                conversation={conversation}
                pending={updateConversation.isPending}
                clearing={clearConversation.isPending}
                canEdit={Boolean(canEditSupport)}
                onSetMode={(mode) => updateConversation.mutate({ mode })}
                onSetStatus={(status) => updateConversation.mutate({ status })}
                onClear={() => setClearDialogOpen(true)}
              />
              <div ref={messagesScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 dark:bg-slate-800/50">
                {loadingConversation && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando conversa...</p>}
                {conversation?.messages.map((message) => <ChatMessage key={message.id} message={message} />)}
                {!loadingConversation && conversation?.messages.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Ainda não há mensagens nesta conversa.</p>}
              </div>
              {canEditSupport ? (
                <form className="border-t border-slate-200 bg-white p-3 dark:bg-slate-900 dark:border-slate-800" onSubmit={(event) => {
                  event.preventDefault();
                  const content = draft.trim();
                  if (!content || sendMessage.isPending) return;
                  setDraft("");
                  setError(null);
                  sendMessage.mutate(content);
                }}>
                  <div className="flex items-end gap-2 rounded-2xl border border-slate-200 p-2 shadow-sm dark:border-slate-800">
                    <Textarea rows={2} className="min-h-[48px] flex-1 resize-none border-0 px-2 py-2 shadow-none focus:ring-0" placeholder="Responder como equipe humana..." value={draft} onChange={(event) => setDraft(event.target.value)} />
                    <Button type="submit" className="h-11 shrink-0" disabled={!draft.trim() || sendMessage.isPending} isLoading={sendMessage.isPending}>Enviar</Button>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">Ao enviar, você assume a conversa como atendimento humano. A IA não responde enquanto ela estiver nesse modo.</p>
                </form>
              ) : <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 dark:bg-slate-800/60 dark:border-slate-800 dark:text-slate-400">Você tem acesso de leitura a este atendimento.</p>}
            </div>
          )}
        </Card>

        <CompanyContext conversation={conversation} />
      </div>

      <Modal open={clearDialogOpen && Boolean(conversation)} onClose={() => !clearConversation.isPending && setClearDialogOpen(false)} title="Limpar conversa">
        <div className="space-y-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-black">Você está prestes a iniciar um novo atendimento.</p>
            <p className="mt-1">As mensagens somem desta central e a IA recebe um contexto novo no próximo contato.</p>
          </div>
          <div className="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <p>Pedidos já criados e registros de consumo continuam preservados.</p>
            <p>Se existir um carrinho de WhatsApp em aberto, ele será cancelado para não gerar pedido incompleto.</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setClearDialogOpen(false)} disabled={clearConversation.isPending}>Cancelar</Button>
            <Button type="button" variant="danger" isLoading={clearConversation.isPending} onClick={() => selectedId && clearConversation.mutate(selectedId)}>Limpar histórico</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ConversationList({ conversations, selectedId, loading, onSelect }: {
  conversations: WhatsAppConversation[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const waitingForHuman = conversations.filter((item) => item.mode === "HUMANO" && item.status === "ABERTA").length;

  return (
    <Card className="flex min-h-[420px] flex-col overflow-hidden xl:h-full xl:min-h-0">
      <div className="shrink-0 border-b border-slate-100 p-4 dark:border-slate-800">
        <p className="text-lg font-black text-slate-900 dark:text-slate-100">Conversas</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{waitingForHuman} aguardando equipe humana</p>
      </div>
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
        {loading && <p className="p-2 text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
        {conversations.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={clsx(
              "w-full rounded-2xl border p-3 text-left transition",
              selectedId === item.id
                ? "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-100 dark:bg-emerald-950/30"
                : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-900",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{item.customerName || formatPhone(item.customerPhone)}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.customerName ? formatPhone(item.customerPhone) : ""}</p>
              </div>
              <span className={clsx(
                "shrink-0 rounded-full px-2 py-1 text-[10px] font-black",
                item.mode === "HUMANO"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
              )}>{item.mode === "HUMANO" ? "Humano" : "IA"}</span>
            </div>
            <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{item.lastMessageText || "Sem mensagem"}</p>
            <div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400">
              <span>{STATUS_LABEL[item.status]}</span>
              <span>{formatDateTime(item.lastMessageAt)}</span>
            </div>
          </button>
        ))}
        {!loading && conversations.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center dark:border-slate-700">
            <p className="text-sm font-black text-slate-700 dark:text-slate-300">Nenhuma conversa ainda</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Assim que alguém chamar o número conectado, a conversa aparece aqui.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConversationHeader({ conversation, pending, clearing, canEdit, onSetMode, onSetStatus, onClear }: {
  conversation?: WhatsAppConversationDetail;
  pending: boolean;
  clearing: boolean;
  canEdit: boolean;
  onSetMode: (mode: WhatsAppConversationMode) => void;
  onSetStatus: (status: WhatsAppConversationStatus) => void;
  onClear: () => void;
}) {
  if (!conversation) return <div className="h-20 shrink-0 animate-pulse bg-slate-100 dark:bg-slate-800" />;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-lg font-black text-slate-900 dark:text-slate-100">{conversation.customerName || formatPhone(conversation.customerPhone)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatPhone(conversation.customerPhone)} · {conversation.channel?.metaDisplayPhoneNumber || "WhatsApp da empresa"}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={conversation.mode === WhatsAppConversationMode.VIRTUAL ? "primary" : "outline"} disabled={pending || clearing} onClick={() => onSetMode(WhatsAppConversationMode.VIRTUAL)}>IA</Button>
            <Button size="sm" variant={conversation.mode === WhatsAppConversationMode.HUMANO ? "primary" : "outline"} disabled={pending || clearing} onClick={() => onSetMode(WhatsAppConversationMode.HUMANO)}>Humano</Button>
            <Button size="sm" variant="outline" disabled={pending || clearing} onClick={() => onSetStatus(conversation.status === WhatsAppConversationStatus.ABERTA ? WhatsAppConversationStatus.ENCERRADA : WhatsAppConversationStatus.ABERTA)}>{conversation.status === WhatsAppConversationStatus.ABERTA ? "Encerrar" : "Reabrir"}</Button>
            <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30" disabled={pending || clearing} onClick={onClear}>Limpar</Button>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${conversation.mode === WhatsAppConversationMode.HUMANO ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"}`}>{MODE_LABEL[conversation.mode]}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">{STATUS_LABEL[conversation.status]}</span>
        {conversation.assignedTo && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Assumida por {conversation.assignedTo.name}</span>}
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: WhatsAppConversationDetail["messages"][number] }) {
  const received = message.direction === WhatsAppMessageDirection.RECEBIDA;
  return <div className={clsx("flex", received ? "justify-start" : "justify-end")}><div className={clsx("max-w-[88%] rounded-2xl px-3 py-2.5 shadow-sm", received ? "rounded-bl-md bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200" : message.status === WhatsAppMessageStatus.FALHOU ? "rounded-br-md bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300" : "rounded-br-md bg-emerald-600 text-white")}><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body || "Conteúdo sem texto"}</p>{message.status === WhatsAppMessageStatus.FALHOU && <p className="mt-1 text-xs font-semibold">Não enviada: {message.errorMessage || "falha na Meta"}</p>}<div className={clsx("mt-1.5 flex gap-2 text-[10px]", received ? "text-slate-400" : message.status === WhatsAppMessageStatus.FALHOU ? "text-rose-600 dark:text-rose-400" : "text-emerald-100")}><span>{received ? "Cliente" : message.sentBy?.name || "Equipe/IA"}</span><span>{formatDateTime(message.createdAt)}</span>{!received && <span>{message.status.toLowerCase()}</span>}</div></div></div>;
}

function CompanyContext({ conversation }: { conversation?: WhatsAppConversationDetail }) {
  if (!conversation) return <Card className="hidden overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col"><CardContent className="h-full min-h-0 overflow-y-auto overscroll-contain p-5"><p className="text-sm font-black text-slate-900 dark:text-slate-100">Informações da empresa</p><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Selecione uma conversa para ver os dados que orientam esse atendimento.</p></CardContent></Card>;
  const company = conversation.company;
  const paymentMethods = company.settings?.paymentMethodsEnabled?.map((item) => item.replaceAll("_", " ")).join(", ") || "Não informado";
  return <Card className="hidden overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col"><CardContent className="h-full min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Contexto do atendimento</p><p className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">{company.name}</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Esses são os dados disponíveis ao atendente virtual desta empresa.</p></div><Info label="Contato" value={company.whatsapp || company.phone || "Não informado"} /><Info label="Endereço" value={[company.addressLine, company.city, company.state].filter(Boolean).join(" · ") || "Não informado"} /><Info label="Entrega" value={`${formatCurrency(Number(company.deliveryFeeBase))} base · ${company.avgDeliveryTimeMinutes} min em média`} /><Info label="Pagamento" value={paymentMethods} /><Info label="Horários" value={formatHours(company.settings?.openingHours)} /><WhatsAppOrderProgress draft={conversation.orderDraft} /><div className="rounded-2xl bg-slate-950 p-4 text-white"><p className="text-xs font-black uppercase tracking-wide text-emerald-300">Modo atual</p><p className="mt-1 text-sm font-black">{MODE_LABEL[conversation.mode]}</p><p className="mt-1 text-xs leading-5 text-slate-300">{conversation.mode === "HUMANO" ? "A equipe tem prioridade e a IA permanece pausada." : "A IA usa o treinamento e os dados acima para responder."}</p></div></CardContent></Card>;
}

function WhatsAppOrderProgress({ draft }: { draft?: WhatsAppConversationDetail["orderDraft"] }) {
  if (!draft) return null;
  const checkout = draft.quoteSnapshot?.checkout;
  const estimate = checkout?.delivery ?? draft.quoteSnapshot?.delivery;
  const labels = {
    MONTANDO: "Montando pedido",
    AGUARDANDO_CONFIRMACAO: "Aguardando confirmação",
    CONCLUIDO: "Pedido criado",
    CANCELADO: "Pedido cancelado",
  } as const;
  const tone = draft.status === "CONCLUIDO"
    ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
    : draft.status === "AGUARDANDO_CONFIRMACAO"
      ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
      : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100";
  return <div className={`rounded-2xl border p-4 ${tone}`}><p className="text-[11px] font-black uppercase tracking-wide opacity-70">Pedido pelo WhatsApp</p><p className="mt-1 text-sm font-black">{labels[draft.status]}</p>{draft.customerName && <p className="mt-2 text-xs">Cliente: {draft.customerName}</p>}{draft.addressStreet && <p className="mt-1 text-xs leading-5">{draft.addressStreet}, {draft.addressNumber} · {draft.addressNeighborhood}, {draft.addressCity}/{draft.addressState}</p>}{estimate && <p className="mt-2 text-xs font-bold">Frete {formatCurrency(Number(estimate.deliveryFee ?? 0))} · {Number(estimate.distanceKm ?? 0).toFixed(1)} km</p>}{checkout?.total !== undefined && <p className="mt-1 text-sm font-black">Total {formatCurrency(Number(checkout.total))}</p>}{draft.status === "AGUARDANDO_CONFIRMACAO" && <p className="mt-2 text-xs leading-5">A IA só finalizará quando o cliente responder <strong>CONFIRMAR</strong>.</p>}</div>;
}

function EmptyConversation({ connected, canConfigure }: { connected: boolean; canConfigure: boolean }) {
  return <CardContent className="grid h-full min-h-[620px] place-items-center p-8 text-center xl:min-h-0"><div className="max-w-sm"><p className="text-xl font-black text-slate-900 dark:text-slate-100">{connected ? "Aguardando uma nova conversa" : "Conecte o WhatsApp da empresa"}</p><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{connected ? "As mensagens recebidas pelo número Meta aparecerão ao vivo nesta central." : "A configuração leva o Phone Number ID e o token da Meta, vinculados apenas a esta empresa."}</p>{canConfigure && <Link href="/painel/configuracoes" className="mt-5 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Ir para configurações</Link>}</div></CardContent>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-sm leading-5 text-slate-700 dark:text-slate-300">{value}</p></div>;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  return phone;
}

function formatHours(hours?: Record<string, string> | null) {
  if (!hours || Object.keys(hours).length === 0) return "Não informado";
  return Object.entries(hours).map(([day, value]) => `${day}: ${value}`).join(" · ");
}
