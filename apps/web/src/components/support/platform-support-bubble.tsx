"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlatformSupportConversationMode,
  PlatformSupportConversationStatus,
  PlatformSupportMessageRole,
  Role,
} from "@chegowia/shared";
import { FloatingAssistantChat } from "@/components/ai/floating-assistant-chat";
import { MarkdownContent } from "@/components/ai/assistant-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { NonCriticalBoundary } from "@/components/system/non-critical-boundary";
import { HumanSupportWhatsAppLink } from "@/components/support/human-support-whatsapp-link";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { connectSocket } from "@/lib/socket-client";

type SupportMessage = {
  id: string;
  role: PlatformSupportMessageRole;
  content: string;
  createdAt: string;
  author: { id: string; name: string; email: string; role: Role } | null;
};

type SupportConversation = {
  id: string;
  userName: string;
  userEmail: string;
  userRole: Role;
  companyName: string | null;
  mode: PlatformSupportConversationMode;
  status: PlatformSupportConversationStatus;
  messages: SupportMessage[];
};

const SUPPORT_QUERY_KEY = ["platform-support-conversation"] as const;

/**
 * A central de suporte é global e pode sobreviver a uma atualização isolada
 * da API. Nunca deixamos uma resposta parcial derrubar o widget inteiro: ela
 * é normalizada antes de chegar à interface e a pessoa continua podendo abrir
 * uma nova conversa normalmente.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function supportRole(value: unknown): PlatformSupportMessageRole {
  return Object.values(PlatformSupportMessageRole).includes(value as PlatformSupportMessageRole)
    ? value as PlatformSupportMessageRole
    : PlatformSupportMessageRole.SISTEMA;
}

function userRole(value: unknown): Role {
  return Object.values(Role).includes(value as Role) ? value as Role : Role.CLIENTE;
}

function conversationMode(value: unknown): PlatformSupportConversationMode {
  return value === PlatformSupportConversationMode.HUMANO
    ? PlatformSupportConversationMode.HUMANO
    : PlatformSupportConversationMode.IA;
}

function conversationStatus(value: unknown): PlatformSupportConversationStatus {
  return value === PlatformSupportConversationStatus.ENCERRADA
    ? PlatformSupportConversationStatus.ENCERRADA
    : PlatformSupportConversationStatus.ABERTA;
}

function normalizeMessage(value: unknown): SupportMessage | null {
  if (!isRecord(value) || !stringValue(value.id)) return null;

  const author = isRecord(value.author) && stringValue(value.author.id)
    ? {
      id: stringValue(value.author.id),
      name: stringValue(value.author.name, "Equipe ChegowIA"),
      email: stringValue(value.author.email),
      role: userRole(value.author.role),
    }
    : null;

  return {
    id: stringValue(value.id),
    role: supportRole(value.role),
    content: stringValue(value.content),
    createdAt: stringValue(value.createdAt),
    author,
  };
}

function normalizeConversation(value: unknown): SupportConversation | null {
  if (!isRecord(value) || !stringValue(value.id)) return null;

  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessage).filter((message): message is SupportMessage => message !== null)
    : [];

  return {
    id: stringValue(value.id),
    userName: stringValue(value.userName, "Você"),
    userEmail: stringValue(value.userEmail),
    userRole: userRole(value.userRole),
    companyName: typeof value.companyName === "string" ? value.companyName : null,
    mode: conversationMode(value.mode),
    status: conversationStatus(value.status),
    messages,
  };
}

function requireConversation(value: unknown): SupportConversation {
  const conversation = normalizeConversation(value);
  if (!conversation) throw new Error("A resposta do suporte não pôde ser lida. Tente novamente.");
  return conversation;
}

/**
 * Canal de ajuda global da ChegowIA. Ele fica separado dos assistentes de
 * operação de cada painel: nenhuma conversa do suporte usa dados de pedidos,
 * empresa ou WhatsApp do tenant no navegador.
 */
export function PlatformSupportBubble() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const accessToken = useAuthStore((state) => state.accessToken);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
  const [draft, setDraft] = useState("");
  const [helpOptionsOpen, setHelpOptionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const isSuperAdmin = user?.role === Role.SUPER_ADMIN;
  const canUseSupport = Boolean(user && accessToken && !isSessionLoading && !isSuperAdmin);

  const conversationQuery = useQuery({
    queryKey: SUPPORT_QUERY_KEY,
    queryFn: async () => normalizeConversation((await api.get<unknown>("/platform/support/conversation")).data),
    enabled: canUseSupport,
    refetchInterval: 30_000,
  });
  const conversation = normalizeConversation(conversationQuery.data);
  const messages = conversation?.messages ?? [];
  const visibleError = error ?? (conversationQuery.isError
    ? apiErrorMessage(conversationQuery.error, "Não foi possível carregar o suporte agora. Tente novamente.")
    : null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SUPPORT_QUERY_KEY });

  useEffect(() => {
    if (!canUseSupport) return;
    const socket = connectSocket();
    const onSupportUpdate = () => refresh();
    socket.on("platform.support.message.received", onSupportUpdate);
    socket.on("platform.support.message.sent", onSupportUpdate);
    socket.on("platform.support.conversation.updated", onSupportUpdate);
    return () => {
      socket.off("platform.support.message.received", onSupportUpdate);
      socket.off("platform.support.message.sent", onSupportUpdate);
      socket.off("platform.support.conversation.updated", onSupportUpdate);
    };
  // queryClient é estável; restringimos a troca do listener ao usuário atual.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseSupport, user?.id]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [conversation?.id, messages.length]);

  const startConversation = useMutation({
    mutationFn: async () => requireConversation((await api.post<unknown>("/platform/support/conversations")).data),
    onSuccess: (created) => {
      setError(null);
      queryClient.setQueryData(SUPPORT_QUERY_KEY, created);
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const requestHuman = useMutation({
    mutationFn: async (conversationId: string) => requireConversation(
      (await api.post<unknown>(`/platform/support/conversations/${conversationId}/human`)).data,
    ),
    onSuccess: (updated) => {
      setError(null);
      queryClient.setQueryData(SUPPORT_QUERY_KEY, updated);
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const sendMessage = useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: string; content: string }) => requireConversation(
      (await api.post<unknown>(`/platform/support/conversations/${conversationId}/messages`, { content })).data,
    ),
    onSuccess: (updated) => {
      setError(null);
      queryClient.setQueryData(SUPPORT_QUERY_KEY, updated);
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const closeConversation = useMutation({
    mutationFn: async (conversationId: string) => api.post(`/platform/support/conversations/${conversationId}/close`),
    onSuccess: () => {
      setDraft("");
      setError(null);
      queryClient.setQueryData(SUPPORT_QUERY_KEY, null);
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  function startWithAi() {
    setError(null);
    startConversation.mutate();
  }

  async function startWithHuman() {
    setError(null);
    try {
      const created = await startConversation.mutateAsync();
      await requestHuman.mutateAsync(created.id);
    } catch {
      // As mutações já mostram uma mensagem amigável em onError.
    }
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!conversation || !content || sendMessage.isPending) return;
    // Depois do envio a caixa fica limpa de imediato; a cópia persistida é a
    // devolvida pelo servidor e nunca é construída apenas no cliente.
    setDraft("");
    setError(null);
    sendMessage.mutate({ conversationId: conversation.id, content });
  }

  return (
    <SupportFloatingChat subtitle="Escolha IA ou equipe humana">
      <NonCriticalBoundary name="painel de conversa do suporte" fallback={<SupportUnavailable />}>
        {!hasHydrated ? <LoadingSupport /> : !user ? <AnonymousSupport /> : isSuperAdmin ? <SuperAdminSupport /> : (
        <div className="flex h-full min-h-0 flex-col bg-slate-50 dark:bg-slate-950">
          {conversation ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-950 dark:text-slate-100">
                    {conversation.mode === PlatformSupportConversationMode.HUMANO ? "Equipe humana acionada" : "Assistente de suporte ativo"}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {conversation.mode === PlatformSupportConversationMode.HUMANO
                      ? "Uma pessoa da ChegowIA acompanha esta conversa."
                      : "Você pode pedir uma pessoa a qualquer momento."}
                  </p>
                </div>
                <span className={clsx(
                  "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
                  conversation.mode === PlatformSupportConversationMode.HUMANO
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
                )}>
                  {conversation.mode === PlatformSupportConversationMode.HUMANO ? "Humano" : "IA"}
                </span>
              </div>

              <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
                {messages.map((message) => <SupportMessageBubble key={message.id} message={message} />)}
              </div>

              {visibleError && <p className="mx-3 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{visibleError}</p>}

              <div className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  className="mb-2 flex min-h-10 w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:hidden"
                  aria-expanded={helpOptionsOpen}
                  aria-controls="support-help-options"
                  onClick={() => setHelpOptionsOpen((current) => !current)}
                >
                  Outras opções de atendimento
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={clsx("h-4 w-4 transition-transform", helpOptionsOpen && "rotate-180")}>
                    <path d="m5 7 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div id="support-help-options" className={clsx("mb-2 space-y-2", helpOptionsOpen ? "block" : "hidden sm:block")}>
                  <HumanSupportWhatsAppLink />
                  {conversation.mode === PlatformSupportConversationMode.IA && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      isLoading={requestHuman.isPending}
                      onClick={() => requestHuman.mutate(conversation.id)}
                    >
                      Falar com uma pessoa
                    </Button>
                  )}
                </div>
                <form onSubmit={handleSend} className="space-y-2">
                  <Textarea
                    rows={2}
                    className="min-h-[72px] resize-none"
                    maxLength={4000}
                    placeholder={conversation.mode === PlatformSupportConversationMode.HUMANO ? "Escreva para a equipe…" : "Digite sua dúvida para a IA…"}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onFocus={() => setHelpOptionsOpen(false)}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="text-xs font-bold text-slate-500 transition hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-300"
                      onClick={() => closeConversation.mutate(conversation.id)}
                      disabled={closeConversation.isPending}
                    >
                      Encerrar conversa
                    </button>
                    <Button type="submit" size="sm" isLoading={sendMessage.isPending} disabled={!draft.trim()}>
                      Enviar
                    </Button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <SupportChoice
              error={visibleError}
              loading={startConversation.isPending || requestHuman.isPending || conversationQuery.isLoading}
              onAi={startWithAi}
              onHuman={startWithHuman}
              onRetry={() => {
                setError(null);
                void conversationQuery.refetch();
              }}
            />
          )}
        </div>
      )}
      </NonCriticalBoundary>
    </SupportFloatingChat>
  );
}

/**
 * Este fallback também é usado pela barreira global. Assim, mesmo que uma
 * consulta ou integração do suporte falhe, a pessoa ainda enxerga e abre o
 * canal — não parece que o suporte simplesmente desapareceu da plataforma.
 */
export function PlatformSupportFallback() {
  return (
    <SupportFloatingChat subtitle="Canal de atendimento">
      <SupportUnavailable />
    </SupportFloatingChat>
  );
}

/**
 * O suporte é global, mas o assistente operacional só existe em algumas
 * telas. Em vez de manter um espaço fixo vazio, observamos o componente
 * compartilhado: se houver assistente, o suporte sobe; se não houver, ele
 * usa diretamente a posição inferior natural daquela tela.
 */
function SupportFloatingChat({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const hasOperationalAssistant = useOperationalAssistantPresence();

  return (
    <FloatingAssistantChat
      position="right"
      stacked={hasOperationalAssistant}
      title="Suporte ChegowIA"
      subtitle={subtitle}
      triggerEyebrow="Suporte ChegowIA"
      triggerLabel="IA ou humano"
      triggerKind="support"
    >
      {children}
    </FloatingAssistantChat>
  );
}

function useOperationalAssistantPresence() {
  const [hasAssistant, setHasAssistant] = useState(false);

  useEffect(() => {
    const sync = () => setHasAssistant(Boolean(document.querySelector('[data-floating-trigger="assistant"]')));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-floating-trigger"],
    });
    return () => observer.disconnect();
  }, []);

  return hasAssistant;
}

function LoadingSupport() {
  return <div className="grid h-full place-items-center bg-slate-50 p-6 text-center dark:bg-slate-950"><span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-r-transparent" /><p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">Preparando seu suporte…</p></div>;
}

function SupportUnavailable() {
  return (
    <div className="flex h-full flex-col justify-center p-6">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl dark:bg-amber-950/35">🛟</span>
      <p className="mt-5 text-xl font-black text-slate-950 dark:text-slate-100">Não foi possível abrir o suporte</p>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">O restante do sistema continua disponível. Reabra este painel para tentar conectar ao atendimento novamente.</p>
      <HumanSupportWhatsAppLink className="mt-5" />
      <button type="button" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_8px_24px_-12px_rgba(234,88,12,.8)] transition hover:bg-brand-700" onClick={() => window.location.reload()}>
        Tentar novamente
      </button>
    </div>
  );
}

function AnonymousSupport() {
  return (
    <div className="flex h-full flex-col justify-center p-6">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-2xl dark:bg-brand-950/35">💬</span>
      <p className="mt-5 text-xl font-black text-slate-950 dark:text-slate-100">Suporte que já sabe quem você é</p>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Entre na sua conta para conversar com a IA de suporte ou pedir uma pessoa da equipe. Assim o atendimento chega com o contexto correto e seguro.</p>
      <HumanSupportWhatsAppLink className="mt-5" />
      <Link href="/acesso" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_8px_24px_-12px_rgba(234,88,12,.8)] transition hover:bg-brand-700">Entrar para falar com o suporte</Link>
    </div>
  );
}

function SuperAdminSupport() {
  return (
    <div className="flex h-full flex-col justify-center p-6">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-2xl dark:bg-emerald-950/35">🛟</span>
      <p className="mt-5 text-xl font-black text-slate-950 dark:text-slate-100">Central de suporte</p>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Veja quem pediu ajuda, acompanhe as mensagens em tempo real e assuma um atendimento humano quando desejar.</p>
      <Link href="/super-admin/suporte" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_8px_24px_-12px_rgba(234,88,12,.8)] transition hover:bg-brand-700">Abrir central de suporte</Link>
    </div>
  );
}

function SupportChoice({ error, loading, onAi, onHuman, onRetry }: { error: string | null; loading: boolean; onAi: () => void; onHuman: () => void; onRetry: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col justify-start overflow-y-auto overscroll-contain p-5 sm:justify-center">
      <p className="text-[10px] font-black uppercase tracking-[.16em] text-brand-600 dark:text-brand-300">Você escolhe o atendimento</p>
      <h3 className="mt-2 text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">Como prefere falar com a ChegowIA?</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">A IA resolve dúvidas rapidamente. Se preferir, encaminhamos direto para uma pessoa da equipe.</p>
      <div className="mt-5 grid gap-3">
        <button type="button" onClick={onAi} disabled={loading} className="group rounded-2xl border border-brand-200 bg-brand-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-lg disabled:cursor-wait disabled:opacity-70 dark:border-brand-900/70 dark:bg-brand-950/25">
          <span className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg text-white">✦</span><span><span className="block text-sm font-black text-slate-950 dark:text-slate-100">Tirar dúvidas com a IA</span><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">Resposta imediata sobre recursos, conta e contratação.</span></span></span>
        </button>
        <button type="button" onClick={onHuman} disabled={loading} className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg disabled:cursor-wait disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900">
          <span className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-lg text-white">🤝</span><span><span className="block text-sm font-black text-slate-950 dark:text-slate-100">Falar com uma pessoa</span><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">A IA avisa a equipe e deixa a conversa em modo humano.</span></span></span>
        </button>
      </div>
      <HumanSupportWhatsAppLink className="mt-3" />
      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/60 dark:bg-rose-950/30">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-200">{error}</p>
          <button type="button" className="mt-2 text-xs font-black text-brand-700 underline underline-offset-2 dark:text-brand-300" onClick={onRetry}>
            Tentar reconectar
          </button>
        </div>
      )}
      <p className="mt-4 text-center text-[11px] leading-5 text-slate-400 dark:text-slate-500">Nunca envie senha, código ou token pelo suporte.</p>
    </div>
  );
}

function SupportMessageBubble({ message }: { message: SupportMessage }) {
  const fromUser = message.role === PlatformSupportMessageRole.USUARIO;
  const fromSystem = message.role === PlatformSupportMessageRole.SISTEMA;
  const authorName = message.role === PlatformSupportMessageRole.SUPER_ADMIN
    ? message.author?.name || "Equipe ChegowIA"
    : message.role === PlatformSupportMessageRole.ASSISTENTE
      ? "Assistente ChegowIA"
      : fromSystem ? "Atualização do atendimento" : "Você";
  return (
    <article className={clsx("flex", fromUser ? "justify-end" : "justify-start")}>
      <div className={clsx(
        "min-w-0 max-w-[94%] rounded-2xl px-3.5 py-3 text-sm leading-6 shadow-sm sm:max-w-[88%]",
        fromUser
          ? "rounded-br-md bg-brand-600 text-white"
          : fromSystem
            ? "border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            : "rounded-bl-md border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
      )}>
        <p className={clsx("mb-1 text-[10px] font-black uppercase tracking-wide", fromUser ? "text-brand-100" : "text-slate-400 dark:text-slate-500")}>{authorName}</p>
        {fromUser || fromSystem
          ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
          : <MarkdownContent content={message.content} />}
        <p className={clsx("mt-1 text-[10px]", fromUser ? "text-brand-100" : "text-slate-400 dark:text-slate-500")}>{formatTime(message.createdAt)}</p>
      </div>
    </article>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
