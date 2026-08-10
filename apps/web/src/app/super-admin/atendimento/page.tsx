"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WhatsAppConversationMode,
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
} from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { connectSocket } from "@/lib/socket-client";
import { Button } from "@/components/ui/button";
import { Card, CardActions, CardContent } from "@/components/ui/card";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

type PlatformChannel = {
  id: string | null;
  status: "ATIVO" | "INATIVO";
  number: string | null;
  automationEnabled: boolean;
  welcomeMessage: string | null;
  salesInstructions: string | null;
  connected: boolean;
  integration: {
    phoneNumberId: string | null;
    businessAccountId: string | null;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
    connectedAt?: string | null;
    lastWebhookAt?: string | null;
    lastError?: string | null;
  };
};

type PlatformConversation = {
  id: string;
  customerPhone: string;
  customerName: string | null;
  mode: WhatsAppConversationMode;
  status: WhatsAppConversationStatus;
  lastMessageText: string | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  humanRequestedAt: string | null;
  _count?: { messages: number };
};

type PlatformMessage = {
  id: string;
  direction: WhatsAppMessageDirection;
  status: WhatsAppMessageStatus;
  type: string;
  body: string | null;
  sentByName: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type PlatformConversationDetail = PlatformConversation & {
  channel: {
    status: "ATIVO" | "INATIVO";
    metaDisplayPhoneNumber: string | null;
    metaVerifiedName: string | null;
    automationEnabled: boolean;
    metaQualityRating: string | null;
  };
  messages: PlatformMessage[];
};

const MODE_LABEL: Record<WhatsAppConversationMode, string> = {
  [WhatsAppConversationMode.VIRTUAL]: "IA comercial",
  [WhatsAppConversationMode.HUMANO]: "Equipe humana",
};

const STATUS_LABEL: Record<WhatsAppConversationStatus, string> = {
  [WhatsAppConversationStatus.ABERTA]: "Aberta",
  [WhatsAppConversationStatus.ENCERRADA]: "Encerrada",
};

const EMPTY_CONNECTION = { phoneNumberId: "", businessAccountId: "", accessToken: "" };
const EMPTY_AUTOMATION = {
  automationEnabled: true,
  welcomeMessage: "",
  salesInstructions: "",
};

export default function SuperAdminAtendimentoPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(true);
  const [connectionForm, setConnectionForm] = useState(EMPTY_CONNECTION);
  const [automationForm, setAutomationForm] = useState(EMPTY_AUTOMATION);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  const { data: channel, isLoading: loadingChannel } = useQuery({
    queryKey: ["platform-whatsapp-channel"],
    queryFn: async () => (await api.get<PlatformChannel>("/platform/whatsapp/channel")).data,
  });
  const { data: conversations = [], isLoading: loadingConversations } = useQuery({
    queryKey: ["platform-whatsapp-conversations"],
    queryFn: async () => (await api.get<PlatformConversation[]>("/platform/whatsapp/conversations")).data,
    refetchInterval: 15_000,
  });
  const { data: conversation, isLoading: loadingConversation } = useQuery({
    queryKey: ["platform-whatsapp-conversation", selectedId],
    queryFn: async () => (await api.get<PlatformConversationDetail>(`/platform/whatsapp/conversations/${selectedId}`)).data,
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!channel) return;
    setConnectionForm((current) => ({
      phoneNumberId: current.phoneNumberId || channel.integration.phoneNumberId || "",
      businessAccountId: current.businessAccountId || channel.integration.businessAccountId || "",
      // A API nunca devolve a credencial. Mesmo com o canal conectado, ela
      // permanece vazia até o superadmin decidir trocar o número/token.
      accessToken: "",
    }));
    setAutomationForm({
      automationEnabled: channel.automationEnabled,
      welcomeMessage: channel.welcomeMessage || "",
      salesInstructions: channel.salesInstructions || "",
    });
    if (channel.connected) setConnectionOpen(false);
  }, [channel]);

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
    const refresh = (payload?: { conversationId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-conversations"] });
      if (!payload?.conversationId || payload.conversationId === selectedId) {
        queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-conversation", selectedId] });
      }
      queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-channel"] });
    };
    socket.on("platform.whatsapp.message.received", refresh);
    socket.on("platform.whatsapp.message.sent", refresh);
    socket.on("platform.whatsapp.message.updated", refresh);
    socket.on("platform.whatsapp.conversation.updated", refresh);
    return () => {
      socket.off("platform.whatsapp.message.received", refresh);
      socket.off("platform.whatsapp.message.sent", refresh);
      socket.off("platform.whatsapp.message.updated", refresh);
      socket.off("platform.whatsapp.conversation.updated", refresh);
    };
  }, [queryClient, selectedId]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [selectedId, conversation?.messages.length, loadingConversation]);

  useEffect(() => setClearDialogOpen(false), [selectedId]);

  const refreshChannel = () => queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-channel"] });
  const refreshConversation = () => {
    queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-conversations"] });
    queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-conversation", selectedId] });
  };

  const connect = useMutation({
    mutationFn: async () => {
      const payload = {
        phoneNumberId: connectionForm.phoneNumberId.trim(),
        businessAccountId: connectionForm.businessAccountId.trim(),
        accessToken: connectionForm.accessToken.trim(),
        automationEnabled: automationForm.automationEnabled,
        welcomeMessage: automationForm.welcomeMessage.trim(),
        salesInstructions: automationForm.salesInstructions.trim(),
      };
      if (!payload.phoneNumberId || !payload.businessAccountId || !payload.accessToken) {
        throw new Error("Informe o Phone Number ID, a conta WhatsApp Business e o token de sistema da Meta.");
      }
      return (await api.put<PlatformChannel>("/platform/whatsapp/channel", payload)).data;
    },
    onSuccess: (saved) => {
      setError(null);
      setConnectionForm({
        phoneNumberId: saved.integration.phoneNumberId || "",
        businessAccountId: saved.integration.businessAccountId || "",
        accessToken: "",
      });
      setConnectionOpen(false);
      refreshChannel();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : apiErrorMessage(cause)),
  });

  const saveAutomation = useMutation({
    mutationFn: async () => (await api.patch<PlatformChannel>("/platform/whatsapp/automation", {
      automationEnabled: automationForm.automationEnabled,
      welcomeMessage: automationForm.welcomeMessage.trim(),
      salesInstructions: automationForm.salesInstructions.trim(),
    })).data,
    onSuccess: () => {
      setError(null);
      refreshChannel();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const updateConversation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      if (!selectedId) throw new Error("Selecione uma conversa.");
      return (await api.patch(`/platform/whatsapp/conversations/${selectedId}`, data)).data;
    },
    onSuccess: () => {
      setError(null);
      refreshConversation();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedId) throw new Error("Selecione uma conversa.");
      return (await api.post(`/platform/whatsapp/conversations/${selectedId}/messages`, { content })).data;
    },
    onSuccess: () => {
      setError(null);
      refreshConversation();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const clearConversation = useMutation({
    mutationFn: async (conversationId: string) => (await api.delete(`/platform/whatsapp/conversations/${conversationId}/messages`)).data,
    onSuccess: () => {
      setClearDialogOpen(false);
      setDraft("");
      setError(null);
      refreshConversation();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const waitingForTeam = conversations.filter((item) => item.mode === WhatsAppConversationMode.HUMANO && item.status === WhatsAppConversationStatus.ABERTA).length;

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-[30px] bg-slate-950 p-6 text-white shadow-xl sm:p-7">
        <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Canal institucional · Superadmin</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Atendimento comercial ChegowIA</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Um número próprio da ChegowIA para responder interessados, explicar a plataforma e conduzir uma contratação — totalmente separado dos WhatsApps das empresas clientes.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx("rounded-full px-3 py-1.5 text-xs font-black", channel?.connected ? "bg-emerald-400/20 text-emerald-200" : "bg-amber-400/20 text-amber-100")}>
              {loadingChannel ? "Verificando canal…" : channel?.connected ? "Número institucional conectado" : "Número ainda não conectado"}
            </span>
            <Button type="button" size="sm" variant="outline" className="border-white/20 bg-white/10 text-white hover:border-white/40 hover:bg-white/20 hover:text-white dark:border-white/20 dark:bg-white/10 dark:text-white" onClick={() => setConnectionOpen((open) => !open)}>
              {connectionOpen ? "Ocultar configuração" : channel?.connected ? "Trocar configuração" : "Cadastrar número"}
            </Button>
          </div>
        </div>
      </header>

      {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}

      {connectionOpen && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 bg-emerald-50/80 px-5 py-4 dark:border-slate-800 dark:bg-emerald-950/20">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Conexão segura da Meta</p>
            <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">Cadastre o WhatsApp institucional</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Use um Phone Number ID que não esteja vinculado a qualquer empresa cliente. A credencial é validada na Meta, cifrada no servidor e nunca volta para o navegador depois de salva.</p>
          </div>
          <CardContent className="grid gap-4 pt-5 lg:grid-cols-2">
            <FormField label="Phone Number ID da Meta">
              <Input inputMode="numeric" placeholder="Ex.: 123456789012345" value={connectionForm.phoneNumberId} onChange={(event) => setConnectionForm((form) => ({ ...form, phoneNumberId: event.target.value.replace(/\D/g, "") }))} />
            </FormField>
            <FormField label="WhatsApp Business Account ID">
              <Input inputMode="numeric" placeholder="Ex.: 123456789012345" value={connectionForm.businessAccountId} onChange={(event) => setConnectionForm((form) => ({ ...form, businessAccountId: event.target.value.replace(/\D/g, "") }))} />
            </FormField>
            <div className="lg:col-span-2">
              <FormField label="Token de sistema/permanente da Meta">
                <Input type="password" autoComplete="new-password" placeholder={channel?.connected ? "Deixe vazio se não quiser trocar o token" : "Cole o token gerado na Meta"} value={connectionForm.accessToken} onChange={(event) => setConnectionForm((form) => ({ ...form, accessToken: event.target.value }))} />
              </FormField>
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Não cole App Secret aqui. Este campo aceita somente o token do número/usuário de sistema com acesso ao WhatsApp Business.</p>
            </div>
          </CardContent>
          <CardActions description="Ao salvar, a ChegowIA confirma o ativo na Meta, assina os webhooks da conta e impede que o mesmo número seja reutilizado em um painel de empresa.">
            <Button type="button" isLoading={connect.isPending} onClick={() => connect.mutate()}>{channel?.connected ? "Validar e atualizar conexão" : "Conectar número institucional"}</Button>
          </CardActions>
        </Card>
      )}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">Assistente de vendas</p>
            <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">Como a IA conversa em nome da ChegowIA</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Ela informa o plano, o teste gratuito e o consumo separado de IA/WhatsApp; qualifica o interesse e direciona a contratação sem pedir dados sensíveis.</p>
          </div>
          <CardContent className="space-y-4 pt-5">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={automationForm.automationEnabled} onChange={(event) => setAutomationForm((form) => ({ ...form, automationEnabled: event.target.checked }))} />
              <span><span className="block text-sm font-black text-slate-900 dark:text-slate-100">Assistente comercial ativo</span><span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">Quando desligado, novas conversas chegam para a equipe humana. Conversas já assumidas por humano nunca recebem resposta automática.</span></span>
            </label>
            <FormField label="Mensagem de boas-vindas e tom inicial (opcional)">
              <Textarea rows={3} className="min-h-[94px]" placeholder="Ex.: Olá! Sou o assistente da ChegowIA. Posso ajudar sua operação a começar." value={automationForm.welcomeMessage} onChange={(event) => setAutomationForm((form) => ({ ...form, welcomeMessage: event.target.value }))} />
            </FormField>
            <FormField label="Orientações comerciais adicionais (opcional)">
              <Textarea rows={5} className="min-h-[130px]" placeholder="Ex.: Priorize restaurantes e deliveries em Goiás; convide interessados para uma demonstração quando fizer sentido." value={automationForm.salesInstructions} onChange={(event) => setAutomationForm((form) => ({ ...form, salesInstructions: event.target.value }))} />
            </FormField>
          </CardContent>
          <CardActions description="As regras de segurança, preço vigente, teste de 7 dias e cobrança por consumo são mantidas pelo sistema; estas orientações não substituem essas proteções.">
            <Button type="button" isLoading={saveAutomation.isPending} onClick={() => saveAutomation.mutate()}>Salvar comportamento do assistente</Button>
          </CardActions>
        </Card>

        <Card className="overflow-hidden bg-slate-950 text-white dark:bg-slate-950">
          <CardContent className="space-y-5 p-5">
            <div><p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">Visão comercial</p><p className="mt-1 text-xl font-black">O que a IA já sabe responder</p></div>
            <ul className="space-y-3 text-sm leading-6 text-slate-300"><li className="flex gap-2"><span className="text-emerald-300">✓</span><span>Como pedidos, cardápio, mesas, delivery, equipe, relatórios e atendimento por WhatsApp se conectam.</span></li><li className="flex gap-2"><span className="text-emerald-300">✓</span><span>O plano atual, teste gratuito de 7 dias e o caminho de contratação.</span></li><li className="flex gap-2"><span className="text-emerald-300">✓</span><span>Que IA e WhatsApp são cobrados por consumo real, separados da mensalidade.</span></li><li className="flex gap-2"><span className="text-emerald-300">✓</span><span>Quando transferir para uma pessoa da equipe sem continuar pressionando a venda.</span></li></ul>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Canal conectado</p><p className="mt-1 break-all text-sm font-black text-white">{channel?.integration.displayPhoneNumber || channel?.number || "Aguardando cadastro"}</p><p className="mt-1 text-xs text-slate-400">{channel?.integration.verifiedName || "Nome comercial será confirmado pela Meta"}</p>{channel?.integration.lastWebhookAt && <p className="mt-3 text-xs text-emerald-200">Webhook recebido: {formatDateTime(channel.integration.lastWebhookAt)}</p>}{channel?.integration.lastError && <p className="mt-3 text-xs leading-5 text-rose-200">Última falha: {channel.integration.lastError}</p>}</div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Inbox isolado</p><h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">Conversas de interessados</h2></div><p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{waitingForTeam} aguardando equipe humana</p></div>
        <div className="grid min-h-[680px] gap-5 xl:h-[calc(100dvh-15rem)] xl:min-h-[560px] xl:max-h-[780px] xl:grid-cols-[320px_minmax(0,1fr)_260px]">
          <ConversationList conversations={conversations} selectedId={selectedId} loading={loadingConversations} onSelect={setSelectedId} />
          <Card className="min-h-[620px] overflow-hidden xl:h-full xl:min-h-0">
            {!conversation && !loadingConversation ? <EmptyConversation connected={Boolean(channel?.connected)} onConfigure={() => setConnectionOpen(true)} /> : <div className="flex h-full min-h-[620px] flex-col xl:min-h-0">
              <ConversationHeader conversation={conversation} pending={updateConversation.isPending} clearing={clearConversation.isPending} onSetMode={(mode) => updateConversation.mutate({ mode })} onSetStatus={(status) => updateConversation.mutate({ status })} onClear={() => setClearDialogOpen(true)} />
              <div ref={messagesScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 dark:bg-slate-800/50">
                {loadingConversation && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando conversa…</p>}
                {conversation?.messages.map((message) => <ChatMessage key={message.id} message={message} />)}
                {!loadingConversation && conversation?.messages.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Ainda não há mensagens nesta conversa.</p>}
              </div>
              <form className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900" onSubmit={(event) => {
                event.preventDefault();
                const content = draft.trim();
                if (!content || sendMessage.isPending) return;
                setDraft("");
                setError(null);
                sendMessage.mutate(content);
              }}>
                <div className="flex items-end gap-2 rounded-2xl border border-slate-200 p-2 shadow-sm dark:border-slate-800"><Textarea rows={2} className="min-h-[48px] flex-1 resize-none border-0 px-2 py-2 shadow-none focus:ring-0" placeholder="Responder como equipe ChegowIA…" value={draft} onChange={(event) => setDraft(event.target.value)} /><Button type="submit" className="h-11 shrink-0" disabled={!draft.trim() || sendMessage.isPending || !channel?.connected} isLoading={sendMessage.isPending}>Enviar</Button></div>
                <p className="mt-2 text-[11px] text-slate-400">Ao responder, a conversa muda para equipe humana e a IA comercial fica pausada.</p>
              </form>
            </div>}
          </Card>
          <AssistantContext conversation={conversation} channel={channel} />
        </div>
      </section>

      <Modal open={clearDialogOpen && Boolean(conversation)} onClose={() => !clearConversation.isPending && setClearDialogOpen(false)} title="Limpar conversa comercial">
        <div className="space-y-5"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-black">Isso reinicia o contexto para o próximo contato.</p><p className="mt-1">As mensagens saem apenas deste inbox institucional. Nenhum dado de empresa cliente é afetado.</p></div><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setClearDialogOpen(false)} disabled={clearConversation.isPending}>Cancelar</Button><Button type="button" variant="danger" isLoading={clearConversation.isPending} onClick={() => selectedId && clearConversation.mutate(selectedId)}>Limpar histórico</Button></div></div>
      </Modal>
    </div>
  );
}

function ConversationList({ conversations, selectedId, loading, onSelect }: { conversations: PlatformConversation[]; selectedId: string | null; loading: boolean; onSelect: (id: string) => void }) {
  return <Card className="flex min-h-[420px] flex-col overflow-hidden xl:h-full xl:min-h-0"><div className="shrink-0 border-b border-slate-100 p-4 dark:border-slate-800"><p className="text-lg font-black text-slate-900 dark:text-slate-100">Conversas</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Somente o número institucional</p></div><CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">{loading && <p className="p-2 text-sm text-slate-500 dark:text-slate-400">Carregando…</p>}{conversations.map((item) => <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={clsx("w-full rounded-2xl border p-3 text-left transition", selectedId === item.id ? "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-100 dark:bg-emerald-950/30" : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-900")}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{item.customerName || formatPhone(item.customerPhone)}</p>{item.customerName && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatPhone(item.customerPhone)}</p>}</div><span className={clsx("shrink-0 rounded-full px-2 py-1 text-[10px] font-black", item.mode === WhatsAppConversationMode.HUMANO ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300")}>{item.mode === WhatsAppConversationMode.HUMANO ? "Humano" : "IA"}</span></div><p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{item.lastMessageText || "Sem mensagem"}</p><div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400"><span>{STATUS_LABEL[item.status]}</span><span>{formatDateTime(item.lastMessageAt)}</span></div></button>)}{!loading && conversations.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center dark:border-slate-700"><p className="text-sm font-black text-slate-700 dark:text-slate-300">Nenhum interessado ainda</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Quando alguém chamar o número da ChegowIA, a conversa aparece aqui em tempo real.</p></div>}</CardContent></Card>;
}

function ConversationHeader({ conversation, pending, clearing, onSetMode, onSetStatus, onClear }: { conversation?: PlatformConversationDetail; pending: boolean; clearing: boolean; onSetMode: (mode: WhatsAppConversationMode) => void; onSetStatus: (status: WhatsAppConversationStatus) => void; onClear: () => void }) {
  if (!conversation) return <div className="h-20 shrink-0 animate-pulse bg-slate-100 dark:bg-slate-800" />;
  return <div className="shrink-0 border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-lg font-black text-slate-900 dark:text-slate-100">{conversation.customerName || formatPhone(conversation.customerPhone)}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatPhone(conversation.customerPhone)} · {conversation.channel?.metaDisplayPhoneNumber || "WhatsApp ChegowIA"}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant={conversation.mode === WhatsAppConversationMode.VIRTUAL ? "primary" : "outline"} disabled={pending || clearing} onClick={() => onSetMode(WhatsAppConversationMode.VIRTUAL)}>IA</Button><Button size="sm" variant={conversation.mode === WhatsAppConversationMode.HUMANO ? "primary" : "outline"} disabled={pending || clearing} onClick={() => onSetMode(WhatsAppConversationMode.HUMANO)}>Humano</Button><Button size="sm" variant="outline" disabled={pending || clearing} onClick={() => onSetStatus(conversation.status === WhatsAppConversationStatus.ABERTA ? WhatsAppConversationStatus.ENCERRADA : WhatsAppConversationStatus.ABERTA)}>{conversation.status === WhatsAppConversationStatus.ABERTA ? "Encerrar" : "Reabrir"}</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30" disabled={pending || clearing} onClick={onClear}>Limpar</Button></div></div><div className="mt-3 flex flex-wrap gap-2"><span className={clsx("rounded-full px-2.5 py-1 text-xs font-bold", conversation.mode === WhatsAppConversationMode.HUMANO ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300")}>{MODE_LABEL[conversation.mode]}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">{STATUS_LABEL[conversation.status]}</span></div></div>;
}

function ChatMessage({ message }: { message: PlatformMessage }) {
  const received = message.direction === WhatsAppMessageDirection.RECEBIDA;
  return <div className={clsx("flex", received ? "justify-start" : "justify-end")}><div className={clsx("max-w-[88%] rounded-2xl px-3 py-2.5 shadow-sm", received ? "rounded-bl-md bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200" : message.status === WhatsAppMessageStatus.FALHOU ? "rounded-br-md bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300" : "rounded-br-md bg-emerald-600 text-white")}><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body || "Conteúdo sem texto"}</p>{message.status === WhatsAppMessageStatus.FALHOU && <p className="mt-1 text-xs font-semibold">Não enviada: {message.errorMessage || "falha na Meta"}</p>}<div className={clsx("mt-1.5 flex gap-2 text-[10px]", received ? "text-slate-400" : message.status === WhatsAppMessageStatus.FALHOU ? "text-rose-600 dark:text-rose-400" : "text-emerald-100")}><span>{received ? "Interessado" : message.sentByName || (message.type === "ai" ? "Assistente ChegowIA" : "Equipe ChegowIA")}</span><span>{formatDateTime(message.createdAt)}</span>{!received && <span>{message.status.toLowerCase()}</span>}</div></div></div>;
}

function AssistantContext({ conversation, channel }: { conversation?: PlatformConversationDetail; channel?: PlatformChannel }) {
  return <Card className="hidden overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col"><CardContent className="h-full min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Contexto comercial</p><p className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">Assistente ChegowIA</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">A IA responde só neste canal institucional e não pode acessar dados de empresas clientes.</p></div><Info label="Estado do canal" value={channel?.connected ? "Conectado e isolado" : "Aguardando configuração"} /><Info label="Automação" value={channel?.automationEnabled ? "Ativa para novas conversas" : "Pausada; equipe humana assume"} />{conversation && <><Info label="Contato interessado" value={formatPhone(conversation.customerPhone)} /><Info label="Modo atual" value={MODE_LABEL[conversation.mode]} /></>}<div className="rounded-2xl bg-slate-950 p-4 text-white"><p className="text-xs font-black uppercase tracking-wide text-emerald-300">Segurança por desenho</p><p className="mt-1 text-sm font-black">Dados nunca se misturam</p><p className="mt-1 text-xs leading-5 text-slate-300">O número, as conversas e a credencial institucional ficam em registros próprios, sem companyId e sem acesso pelos painéis de clientes.</p></div></CardContent></Card>;
}

function EmptyConversation({ connected, onConfigure }: { connected: boolean; onConfigure: () => void }) {
  return <CardContent className="grid h-full min-h-[620px] place-items-center p-8 text-center xl:min-h-0"><div className="max-w-sm"><p className="text-xl font-black text-slate-900 dark:text-slate-100">{connected ? "Aguardando um novo interessado" : "Cadastre o WhatsApp da ChegowIA"}</p><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{connected ? "As mensagens recebidas pelo número institucional surgirão ao vivo nesta central." : "Conecte um Phone Number ID próprio da plataforma. Ele não pode ser compartilhado com uma empresa cliente."}</p><Button type="button" className="mt-5" onClick={onConfigure}>{connected ? "Ver configuração" : "Cadastrar número"}</Button></div></CardContent>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-sm leading-5 text-slate-700 dark:text-slate-300">{value}</p></div>;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  return phone;
}
