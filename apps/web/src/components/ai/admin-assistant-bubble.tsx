"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AIAgentRole } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { AIConversation, AIConversationDetail } from "@/lib/types";
import { AssistantMessage, UserMessage } from "@/components/ai/assistant-message";
import { FloatingAssistantChat } from "@/components/ai/floating-assistant-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

const AGENTS = {
  [AIAgentRole.OPERACIONAL]: {
    label: "Operacional",
    description: "Pedidos, vendas, atrasos e oportunidades",
    color: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  },
  [AIAgentRole.ONBOARDING]: {
    label: "Cardápio e onboarding",
    description: "Produtos, categorias e descrições",
    color: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  },
} as const;

const SUGGESTIONS = [
  "Resuma a operação de hoje",
  "Quais pedidos precisam de atenção?",
  "Sugira uma ação para aumentar as vendas",
];

type View = "chat" | "conversations" | "new";

export function AdminAssistantBubble() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("conversations");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [newAgentRole, setNewAgentRole] = useState<AIAgentRole>(AIAgentRole.OPERACIONAL);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data: conversations = [], isLoading: loadingList } = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: async () => (await api.get<AIConversation[]>("/ai/conversations")).data,
  });

  const { data: conversation, isLoading } = useQuery({
    queryKey: ["ai-conversation", conversationId],
    queryFn: async () => (await api.get<AIConversationDetail>(`/ai/conversations/${conversationId}`)).data,
    enabled: !!conversationId,
  });

  const createConversation = useMutation({
    mutationFn: async () =>
      (
        await api.post<AIConversation>("/ai/conversations", {
          agentRole: newAgentRole,
          title: `Conversa com ${agentInfo(newAgentRole).label}`,
        })
      ).data,
    onSuccess: (created) => {
      setConversationId(created.id);
      setView("chat");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error("Selecione ou crie uma conversa.");
      await api.post(`/ai/conversations/${conversationId}/messages`, { content: message });
    },
    onSuccess: () => {
      setMessage("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["ai-conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const messages = (conversation?.messages ?? []).filter((item) => item.role !== "SYSTEM" && item.role !== "TOOL");
  const currentAgent = agentInfo(conversation?.agentRole ?? newAgentRole);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, send.isPending, isLoading]);

  function openConversation(id: string) {
    setConversationId(id);
    setView("chat");
    setError(null);
  }

  return (
    <FloatingAssistantChat
      title={view === "chat" && conversation ? conversation.title || currentAgent.label : "Central ChegowIA"}
      subtitle={view === "chat" && conversation ? currentAgent.description : "Agentes e conversas em um só lugar."}
      triggerEyebrow="Assistente ChegowIA"
      triggerLabel="Como posso ajudar?"
    >
      <div className="flex h-full min-h-0 flex-col bg-slate-50/70 dark:bg-slate-800/50">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:bg-slate-900 dark:border-slate-800">
          <ToolbarButton active={view === "conversations"} onClick={() => setView("conversations")}>
            Conversas
            {conversations.length > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] dark:bg-slate-800">{conversations.length}</span>}
          </ToolbarButton>
          <ToolbarButton active={view === "new"} onClick={() => setView("new")}>+ Nova</ToolbarButton>
          {conversationId && <ToolbarButton active={view === "chat"} onClick={() => setView("chat")}>Chat</ToolbarButton>}
        </div>

        {view === "conversations" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 rounded-2xl bg-slate-950 p-4 text-white">
              <p className="text-xs font-black uppercase tracking-[0.15em] text-brand-300">Seu histórico</p>
              <p className="mt-1 text-sm text-slate-300">Continue exatamente de onde parou ou inicie outro especialista.</p>
            </div>
            {loadingList && <p className="p-3 text-sm text-slate-500 dark:text-slate-400">Carregando conversas...</p>}
            <div className="space-y-2">
              {conversations.map((item) => {
                const info = agentInfo(item.agentRole);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openConversation(item.id)}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:bg-slate-900 dark:border-slate-800"
                  >
                    <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-black", info.color)}>
                      {info.label.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">
                        {item.title || `Conversa ${info.label}`}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {info.label} · {item._count?.messages ?? 0} mensagens · {formatDateTime(item.updatedAt)}
                      </span>
                    </span>
                    <span className="text-lg text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600">›</span>
                  </button>
                );
              })}
              {!loadingList && conversations.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center dark:bg-slate-900 dark:border-slate-700">
                  <p className="font-black text-slate-900 dark:text-slate-100">Nenhuma conversa ainda</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Escolha um agente e comece por aqui.</p>
                  <Button size="sm" className="mt-4" onClick={() => setView("new")}>Criar conversa</Button>
                </div>
              )}
            </div>
          </div>
        )}

        {view === "new" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="text-lg font-black text-slate-950 dark:text-slate-100">Quem você quer chamar?</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Cada agente mantém sua própria conversa e contexto.</p>
            <div className="mt-4 space-y-3">
              {(Object.keys(AGENTS) as AIAgentRole[]).map((role) => {
                const info = AGENTS[role as keyof typeof AGENTS];
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setNewAgentRole(role)}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-2xl border bg-white p-4 text-left transition dark:bg-slate-900",
                      newAgentRole === role ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-200 dark:border-slate-800",
                    )}
                  >
                    <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xs font-black", info.color)}>
                      {info.label.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <span className="block text-sm font-black text-slate-950 dark:text-slate-100">{info.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{info.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Button className="mt-5 w-full" isLoading={createConversation.isPending} onClick={() => createConversation.mutate()}>
              Iniciar com {agentInfo(newAgentRole).label}
            </Button>
          </div>
        )}

        {view === "chat" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <div className="flex shrink-0 items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:bg-slate-900 dark:border-slate-800">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{conversation?.title || currentAgent.label}</p>
                <p className="text-[11px] text-slate-400">{currentAgent.label} · contexto salvo</p>
              </div>
              <button type="button" onClick={() => setView("conversations")} className="rounded-lg px-2 py-1 text-xs font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300">
                Trocar
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-3 dark:bg-slate-900 dark:border-slate-800">
              {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando conversa...</p>}
              {messages.length === 0 && !isLoading && (
                <>
                  <AssistantMessage compact content={`Olá! Sou o agente **${currentAgent.label}**. ${currentAgent.description}. Como posso ajudar?`} />
                  {conversation?.agentRole === AIAgentRole.OPERACIONAL && (
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTIONS.map((suggestion) => (
                        <button key={suggestion} type="button" onClick={() => setMessage(suggestion)} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-2 text-left text-xs font-bold text-brand-700 hover:bg-brand-600 hover:text-white">
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {messages.map((item) =>
                item.role === "USER" ? <UserMessage key={item.id} content={item.content} /> : <AssistantMessage key={item.id} compact content={item.content} />,
              )}
              <div ref={endRef} />
            </div>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
            <form
              className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:bg-slate-900 dark:border-slate-800"
              onSubmit={(event) => {
                event.preventDefault();
                if (message.trim() && !send.isPending) send.mutate();
              }}
            >
              <Textarea rows={2} className="min-h-[46px] flex-1 resize-none border-0 px-2 py-2 shadow-none focus:ring-0" placeholder={`Pergunte ao agente ${currentAgent.label.toLowerCase()}...`} value={message} onChange={(event) => setMessage(event.target.value)} />
              <Button type="submit" aria-label="Enviar" className="h-11 w-11 shrink-0 rounded-full px-0 text-lg" disabled={!message.trim()} isLoading={send.isPending}>↑</Button>
            </form>
          </div>
        )}
      </div>
    </FloatingAssistantChat>
  );
}

function ToolbarButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={clsx("flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition", active ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100")}>
      {children}
    </button>
  );
}

function agentInfo(role: AIAgentRole | string) {
  return AGENTS[role as keyof typeof AGENTS] ?? {
    label: role === AIAgentRole.ATENDIMENTO ? "Atendimento" : "Assistente",
    description: "Apoio inteligente para sua empresa",
    color: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  };
}
