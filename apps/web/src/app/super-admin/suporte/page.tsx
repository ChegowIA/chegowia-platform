"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlatformSupportConversationMode,
  PlatformSupportConversationStatus,
  PlatformSupportMessageRole,
  Role,
} from "@chegowia/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { connectSocket } from "@/lib/socket-client";

type SupportConversationSummary = {
  id: string;
  userName: string;
  userEmail: string;
  userRole: Role;
  companyName: string | null;
  mode: PlatformSupportConversationMode;
  status: PlatformSupportConversationStatus;
  lastMessageText: string | null;
  lastMessageAt: string;
  humanRequestedAt: string | null;
  assignedSuperAdmin: { id: string; name: string; email: string } | null;
  messageCount: number;
  createdAt: string;
};

type SupportMessage = {
  id: string;
  role: PlatformSupportMessageRole;
  content: string;
  createdAt: string;
  author: { id: string; name: string; email: string; role: Role } | null;
};

type SupportConversationDetail = SupportConversationSummary & {
  userId: string;
  companyId: string | null;
  humanHandoffNotifiedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  messages: SupportMessage[];
};

const MODE_LABEL: Record<PlatformSupportConversationMode, string> = {
  [PlatformSupportConversationMode.IA]: "Assistente de IA",
  [PlatformSupportConversationMode.HUMANO]: "Equipe humana",
};

const STATUS_LABEL: Record<PlatformSupportConversationStatus, string> = {
  [PlatformSupportConversationStatus.ABERTA]: "Aberta",
  [PlatformSupportConversationStatus.ENCERRADA]: "Encerrada",
};

export default function SuperAdminSupportPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"" | PlatformSupportConversationMode>("");
  const [statusFilter, setStatusFilter] = useState<"" | PlatformSupportConversationStatus>(PlatformSupportConversationStatus.ABERTA);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  const queryParams = useMemo(() => ({
    search: search.trim() || undefined,
    mode: modeFilter || undefined,
    status: statusFilter || undefined,
  }), [search, modeFilter, statusFilter]);

  const { data: conversations = [], isLoading: loadingConversations } = useQuery({
    queryKey: ["platform-support-conversations", queryParams],
    queryFn: async () => (await api.get<SupportConversationSummary[]>("/platform/support/admin/conversations", { params: queryParams })).data,
    refetchInterval: 15_000,
  });

  const { data: conversation, isLoading: loadingConversation } = useQuery({
    queryKey: ["platform-support-conversation-admin", selectedId],
    queryFn: async () => (await api.get<SupportConversationDetail>(`/platform/support/admin/conversations/${selectedId}`)).data,
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!conversations.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !conversations.some((item) => item.id === selectedId)) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  useEffect(() => {
    const socket = connectSocket();
    const refresh = (payload?: { conversationId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["platform-support-conversations"] });
      if (!payload?.conversationId || payload.conversationId === selectedId) {
        queryClient.invalidateQueries({ queryKey: ["platform-support-conversation-admin", selectedId] });
      }
    };
    socket.on("platform.support.message.received", refresh);
    socket.on("platform.support.message.sent", refresh);
    socket.on("platform.support.conversation.updated", refresh);
    return () => {
      socket.off("platform.support.message.received", refresh);
      socket.off("platform.support.message.sent", refresh);
      socket.off("platform.support.conversation.updated", refresh);
    };
  }, [queryClient, selectedId]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [selectedId, conversation?.messages.length, loadingConversation]);

  useEffect(() => setClearDialogOpen(false), [selectedId]);

  const refreshConversations = () => {
    queryClient.invalidateQueries({ queryKey: ["platform-support-conversations"] });
    queryClient.invalidateQueries({ queryKey: ["platform-support-conversation-admin", selectedId] });
  };

  const updateConversation = useMutation({
    mutationFn: async (payload: { mode?: PlatformSupportConversationMode; status?: PlatformSupportConversationStatus }) => {
      if (!selectedId) throw new Error("Selecione um atendimento.");
      return (await api.patch<SupportConversationDetail>(`/platform/support/admin/conversations/${selectedId}`, payload)).data;
    },
    onSuccess: (updated) => {
      setError(null);
      queryClient.setQueryData(["platform-support-conversation-admin", updated.id], updated);
      refreshConversations();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedId) throw new Error("Selecione um atendimento.");
      return (await api.post<SupportConversationDetail>(`/platform/support/admin/conversations/${selectedId}/messages`, { content })).data;
    },
    onSuccess: (updated) => {
      setError(null);
      queryClient.setQueryData(["platform-support-conversation-admin", updated.id], updated);
      refreshConversations();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const clearConversation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Selecione um atendimento.");
      return api.delete(`/platform/support/admin/conversations/${selectedId}/messages`);
    },
    onSuccess: () => {
      setClearDialogOpen(false);
      setDraft("");
      setError(null);
      refreshConversations();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!conversation || !content || sendMessage.isPending) return;
    // A mensagem vai ao servidor antes de aparecer; o textarea sempre limpa
    // depois do clique, evitando reenvio acidental da mesma resposta.
    setDraft("");
    setError(null);
    sendMessage.mutate(content);
  }

  const waitingForHuman = conversations.filter((item) => item.status === PlatformSupportConversationStatus.ABERTA && item.mode === PlatformSupportConversationMode.HUMANO).length;
  const automated = conversations.filter((item) => item.status === PlatformSupportConversationStatus.ABERTA && item.mode === PlatformSupportConversationMode.IA).length;

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-[30px] bg-slate-950 p-6 text-white shadow-xl sm:p-7">
        <div className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Central global · Superadmin</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Suporte da ChegowIA</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Converse em tempo real com qualquer usuário da plataforma. A pessoa escolhe IA ou humano; você pode assumir uma conversa quando necessário, sempre com aviso prévio no histórico.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <MetricPill label="Aguardando humano" value={waitingForHuman} className="bg-amber-400/15 text-amber-100" />
            <MetricPill label="Com IA" value={automated} className="bg-emerald-400/15 text-emerald-100" />
          </div>
        </div>
      </header>

      {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}

      <div className="grid min-h-[680px] gap-5 xl:h-[calc(100dvh-15rem)] xl:min-h-[560px] xl:max-h-[820px] xl:grid-cols-[330px_minmax(0,1fr)_270px]">
        <SupportList
          conversations={conversations}
          selectedId={selectedId}
          loading={loadingConversations}
          search={search}
          mode={modeFilter}
          status={statusFilter}
          onSearch={setSearch}
          onMode={setModeFilter}
          onStatus={setStatusFilter}
          onSelect={setSelectedId}
        />

        <Card className="min-h-[620px] overflow-hidden xl:h-full xl:min-h-0">
          {!conversation && !loadingConversation ? <EmptySupportConversation /> : (
            <div className="flex h-full min-h-[620px] flex-col xl:min-h-0">
              <SupportConversationHeader
                conversation={conversation}
                pending={updateConversation.isPending || clearConversation.isPending}
                onSetMode={(mode) => updateConversation.mutate({ mode })}
                onSetStatus={(status) => updateConversation.mutate({ status })}
                onClear={() => setClearDialogOpen(true)}
              />
              <div ref={messagesScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 dark:bg-slate-800/50">
                {loadingConversation && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando atendimento…</p>}
                {conversation?.messages.map((message) => <SupportChatMessage key={message.id} message={message} />)}
                {!loadingConversation && conversation?.messages.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">O histórico foi limpo. A próxima mensagem reiniciará o contexto.</p>}
              </div>
              <form className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900" onSubmit={handleSend}>
                <div className="flex items-end gap-2 rounded-2xl border border-slate-200 p-2 shadow-sm dark:border-slate-800">
                  <Textarea rows={2} className="min-h-[52px] flex-1 resize-none border-0 px-2 py-2 shadow-none focus:ring-0" placeholder={conversation?.status === PlatformSupportConversationStatus.ENCERRADA ? "Reabra o atendimento para responder…" : "Responder como superadministrador…"} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={conversation?.status === PlatformSupportConversationStatus.ENCERRADA} />
                  <Button type="submit" className="h-11 shrink-0" disabled={!draft.trim() || sendMessage.isPending || conversation?.status === PlatformSupportConversationStatus.ENCERRADA} isLoading={sendMessage.isPending}>Enviar</Button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">Ao enviar a primeira resposta humana, a pessoa recebe antes um aviso explícito de que um superadministrador entrou no atendimento.</p>
              </form>
            </div>
          )}
        </Card>

        <SupportContext conversation={conversation} />
      </div>

      <Modal open={clearDialogOpen && Boolean(conversation)} onClose={() => !clearConversation.isPending && setClearDialogOpen(false)} title="Limpar histórico de suporte">
        <div className="space-y-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-black">Esta ação remove as mensagens desta conversa.</p>
            <p className="mt-1">O usuário e o vínculo do atendimento são preservados. Use apenas quando for realmente necessário, pois o histórico deixa de estar disponível para a equipe.</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setClearDialogOpen(false)} disabled={clearConversation.isPending}>Cancelar</Button>
            <Button type="button" variant="danger" isLoading={clearConversation.isPending} onClick={() => clearConversation.mutate()}>Limpar histórico</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SupportList({ conversations, selectedId, loading, search, mode, status, onSearch, onMode, onStatus, onSelect }: {
  conversations: SupportConversationSummary[];
  selectedId: string | null;
  loading: boolean;
  search: string;
  mode: "" | PlatformSupportConversationMode;
  status: "" | PlatformSupportConversationStatus;
  onSearch: (value: string) => void;
  onMode: (value: "" | PlatformSupportConversationMode) => void;
  onStatus: (value: "" | PlatformSupportConversationStatus) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="flex min-h-[500px] flex-col overflow-hidden xl:h-full xl:min-h-0">
      <div className="shrink-0 border-b border-slate-100 p-4 dark:border-slate-800">
        <p className="text-lg font-black text-slate-900 dark:text-slate-100">Atendimentos</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Fila única de todos os perfis da plataforma</p>
        <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar nome, e-mail ou empresa" className="mt-4 min-h-10 text-xs" />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Select value={mode} onChange={(event) => onMode(event.target.value as "" | PlatformSupportConversationMode)} className="min-h-10 py-1.5 text-xs"><option value="">Todos os modos</option><option value={PlatformSupportConversationMode.HUMANO}>Humano</option><option value={PlatformSupportConversationMode.IA}>IA</option></Select>
          <Select value={status} onChange={(event) => onStatus(event.target.value as "" | PlatformSupportConversationStatus)} className="min-h-10 py-1.5 text-xs"><option value="">Todas</option><option value={PlatformSupportConversationStatus.ABERTA}>Abertas</option><option value={PlatformSupportConversationStatus.ENCERRADA}>Encerradas</option></Select>
        </div>
      </div>
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
        {loading && <p className="p-2 text-sm text-slate-500 dark:text-slate-400">Carregando…</p>}
        {conversations.map((item) => <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={clsx("w-full rounded-2xl border p-3 text-left transition", selectedId === item.id ? "border-brand-300 bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-950/30" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900")}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{item.userName}</p><p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{item.userEmail}</p></div><ModeTag mode={item.mode} /></div>
          <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-slate-400"><span>{roleLabel(item.userRole)}</span>{item.companyName && <><span>•</span><span className="truncate">{item.companyName}</span></>}</div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{item.lastMessageText || "Atendimento aberto, aguardando a primeira mensagem."}</p>
          <div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400"><span>{STATUS_LABEL[item.status]}</span><span>{formatDateTime(item.lastMessageAt)}</span></div>
        </button>)}
        {!loading && conversations.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center dark:border-slate-700"><p className="text-sm font-black text-slate-700 dark:text-slate-300">Nenhum atendimento encontrado</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Quando um usuário abrir o balão de suporte, ele aparecerá aqui em tempo real.</p></div>}
      </CardContent>
    </Card>
  );
}

function SupportConversationHeader({ conversation, pending, onSetMode, onSetStatus, onClear }: { conversation?: SupportConversationDetail; pending: boolean; onSetMode: (mode: PlatformSupportConversationMode) => void; onSetStatus: (status: PlatformSupportConversationStatus) => void; onClear: () => void }) {
  if (!conversation) return <div className="h-28 shrink-0 animate-pulse bg-slate-100 dark:bg-slate-800" />;
  const isOpen = conversation.status === PlatformSupportConversationStatus.ABERTA;
  return <div className="shrink-0 border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><p className="truncate text-lg font-black text-slate-900 dark:text-slate-100">{conversation.userName}</p><p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{conversation.userEmail} · {roleLabel(conversation.userRole)}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant={conversation.mode === PlatformSupportConversationMode.IA ? "primary" : "outline"} disabled={pending || !isOpen} onClick={() => onSetMode(PlatformSupportConversationMode.IA)}>IA</Button><Button size="sm" variant={conversation.mode === PlatformSupportConversationMode.HUMANO ? "primary" : "outline"} disabled={pending || !isOpen} onClick={() => onSetMode(PlatformSupportConversationMode.HUMANO)}>Humano</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => onSetStatus(isOpen ? PlatformSupportConversationStatus.ENCERRADA : PlatformSupportConversationStatus.ABERTA)}>{isOpen ? "Encerrar" : "Reabrir"}</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30" disabled={pending} onClick={onClear}>Limpar</Button></div></div><div className="mt-3 flex flex-wrap gap-2"><ModeTag mode={conversation.mode} /><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">{STATUS_LABEL[conversation.status]}</span>{conversation.humanRequestedAt && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Solicitou pessoa</span>}</div></div>;
}

function SupportChatMessage({ message }: { message: SupportMessage }) {
  const userMessage = message.role === PlatformSupportMessageRole.USUARIO;
  const systemMessage = message.role === PlatformSupportMessageRole.SISTEMA;
  const label = userMessage ? "Usuário" : message.role === PlatformSupportMessageRole.SUPER_ADMIN ? message.author?.name || "Superadmin ChegowIA" : systemMessage ? "Atualização do atendimento" : "Assistente ChegowIA";
  return <div className={clsx("flex", userMessage ? "justify-start" : "justify-end")}><div className={clsx("max-w-[88%] rounded-2xl px-3.5 py-3 shadow-sm", userMessage ? "rounded-bl-md bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200" : systemMessage ? "rounded-br-md border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" : message.role === PlatformSupportMessageRole.ASSISTENTE ? "rounded-br-md bg-brand-50 text-slate-800 dark:bg-brand-950/40 dark:text-slate-100" : "rounded-br-md bg-emerald-600 text-white")}><p className={clsx("mb-1 text-[10px] font-black uppercase tracking-wide", message.role === PlatformSupportMessageRole.SUPER_ADMIN ? "text-emerald-100" : "text-slate-400 dark:text-slate-500")}>{label}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p><p className={clsx("mt-1.5 text-[10px]", message.role === PlatformSupportMessageRole.SUPER_ADMIN ? "text-emerald-100" : "text-slate-400 dark:text-slate-500")}>{formatDateTime(message.createdAt)}</p></div></div>;
}

function SupportContext({ conversation }: { conversation?: SupportConversationDetail }) {
  return <Card className="hidden overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col"><CardContent className="h-full min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5"><div><p className="text-xs font-black uppercase tracking-[.14em] text-emerald-700 dark:text-emerald-300">Contexto seguro</p><p className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">Quem pediu suporte</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Os dados exibidos foram vinculados pelo servidor ao usuário autenticado quando o atendimento foi aberto.</p></div>{conversation ? <><Info label="Usuário" value={conversation.userName} /><Info label="E-mail" value={conversation.userEmail} /><Info label="Perfil" value={roleLabel(conversation.userRole)} /><Info label="Empresa vinculada" value={conversation.companyName || "Sem empresa vinculada"} /><Info label="Modo atual" value={MODE_LABEL[conversation.mode]} /><Info label="Responsável" value={conversation.assignedSuperAdmin?.name || "Ainda não atribuído"} /><Info label="Atendimento iniciado" value={formatDateTime(conversation.createdAt)} /><div className="rounded-2xl bg-slate-950 p-4 text-white"><p className="text-xs font-black uppercase tracking-wide text-emerald-300">Controle humano</p><p className="mt-1 text-sm font-black">Troca transparente</p><p className="mt-1 text-xs leading-5 text-slate-300">Ao colocar a conversa em modo humano, o sistema registra e entrega primeiro o aviso à pessoa antes de qualquer mensagem do superadmin.</p></div></> : <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">Selecione um atendimento para ver o contexto do usuário e assumir a conversa.</div>}</CardContent></Card>;
}

function ModeTag({ mode }: { mode: PlatformSupportConversationMode }) {
  return <span className={clsx("shrink-0 rounded-full px-2 py-1 text-[10px] font-black", mode === PlatformSupportConversationMode.HUMANO ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300")}>{mode === PlatformSupportConversationMode.HUMANO ? "Humano" : "IA"}</span>;
}

function MetricPill({ label, value, className }: { label: string; value: number; className: string }) {
  return <span className={clsx("rounded-full px-3 py-2 text-xs font-black", className)}>{value} {label}</span>;
}

function EmptySupportConversation() {
  return <CardContent className="grid h-full min-h-[620px] place-items-center p-8 text-center xl:min-h-0"><div className="max-w-sm"><span className="text-4xl">🛟</span><p className="mt-4 text-xl font-black text-slate-900 dark:text-slate-100">Aguardando um pedido de suporte</p><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">A central recebe solicitações de administradores, funcionários, garçons, motoboys, clientes e revendedores, sempre no perfil correto.</p></div></CardContent>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-sm leading-5 text-slate-700 dark:text-slate-300">{value}</p></div>;
}

function roleLabel(role: Role) {
  const labels: Record<Role, string> = {
    [Role.SUPER_ADMIN]: "Superadministrador",
    [Role.ADMIN]: "Administrador",
    [Role.FUNCIONARIO]: "Funcionário",
    [Role.COZINHA]: "Cozinha",
    [Role.MOTOBOY]: "Motoboy",
    [Role.GARCOM]: "Garçom",
    [Role.CLIENTE]: "Cliente",
    [Role.REVENDEDOR]: "Revendedor",
  };
  return labels[role] || "Usuário";
}
