"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AIAgentRole } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { AIConversation, AIConversationDetail } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AssistantMessage, UserMessage } from "@/components/ai/assistant-message";
import { FloatingAssistantChat } from "@/components/ai/floating-assistant-chat";

const AGENT_ROLE_LABELS: Record<AIAgentRole, string> = {
  [AIAgentRole.OPERACIONAL]: "Operacional",
  [AIAgentRole.ONBOARDING]: "Onboarding",
  [AIAgentRole.ATENDIMENTO]: "Atendimento",
};

export default function AgentePage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [newAgentRole, setNewAgentRole] = useState<AIAgentRole>(AIAgentRole.OPERACIONAL);
  const [message, setMessage] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data: conversations } = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: async () => {
      const { data } = await api.get<AIConversation[]>("/ai/conversations");
      return data;
    },
  });

  const { data: conversation, isLoading: loadingConversation } = useQuery({
    queryKey: ["ai-conversation", selectedConversationId],
    queryFn: async () => {
      const { data } = await api.get<AIConversationDetail>(`/ai/conversations/${selectedConversationId}`);
      return data;
    },
    enabled: !!selectedConversationId,
  });

  const createConversation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<AIConversation>("/ai/conversations", { agentRole: newAgentRole });
      return data;
    },
    onSuccess: (data) => {
      setError(null);
      setSelectedConversationId(data.id);
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!selectedConversationId) return;
      const { data } = await api.post(`/ai/conversations/${selectedConversationId}/messages`, { content: message });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["ai-conversation", selectedConversationId] });
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const visibleMessages = (conversation?.messages ?? []).filter((item) => item.role !== "TOOL" && item.role !== "SYSTEM");
  const selectedTitle = conversation?.title || (conversation ? AGENT_ROLE_LABELS[conversation.agentRole] : "Chat");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length, sendMessage.isPending, loadingConversation]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Agente operacional</p>
          <h1 className="mt-1 text-3xl font-black text-slate-950 dark:text-slate-50">Agente de IA</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Analise operação, crie rascunhos de campanha e melhore respostas com dados da empresa.
          </p>
        </div>
        <Link href="/painel/relatorios">
          <Button variant="outline">Promoções pendentes</Button>
        </Link>
      </div>

      <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:bg-brand-950/30 dark:border-brand-900/50 dark:text-brand-200">
        Respostas seguem uma estrutura fixa: resumo curto, dados encontrados, atenção e próximo passo. Ações sensíveis
        continuam exigindo confirmação humana.
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Conversas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Select value={newAgentRole} onChange={(e) => setNewAgentRole(e.target.value as AIAgentRole)}>
                {Object.values(AIAgentRole)
                  .filter((role) => role === AIAgentRole.OPERACIONAL || role === AIAgentRole.ONBOARDING)
                  .map((role) => (
                    <option key={role} value={role}>
                      {AGENT_ROLE_LABELS[role] ?? role}
                    </option>
                  ))}
              </Select>
              <Button size="sm" isLoading={createConversation.isPending} onClick={() => createConversation.mutate()}>
                Nova conversa
              </Button>
            </div>

            <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {conversations?.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedConversationId(item.id)}
                  className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                    selectedConversationId === item.id
                      ? "border-brand-200 bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:border-brand-900/60 dark:text-brand-300"
                      : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50/60 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="line-clamp-1 text-sm font-bold">
                      {item.title || AGENT_ROLE_LABELS[item.agentRole] || item.agentRole}
                    </p>
                    <Badge tone="neutral">{item._count?.messages ?? 0}</Badge>
                  </div>
                  <p className="text-xs text-slate-400">{formatDateTime(item.updatedAt)}</p>
                </button>
              ))}
              {conversations?.length === 0 && <p className="px-3 text-xs text-slate-400">Nenhuma conversa ainda.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{conversation ? "Conversa selecionada" : "Agente"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Perfil</p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {conversation ? AGENT_ROLE_LABELS[conversation.agentRole] : AGENT_ROLE_LABELS[newAgentRole]}
              </p>
            </div>
            <div className="rounded-lg bg-brand-50 px-4 py-3 dark:bg-brand-950/30">
              <p className="text-xs font-semibold text-brand-900 dark:text-brand-200">Mensagens</p>
              <p className="mt-1 text-sm font-bold text-brand-700 dark:text-brand-300">{visibleMessages.length}</p>
            </div>
            <div className="rounded-lg bg-accent-50 px-4 py-3">
              <p className="text-xs font-semibold text-accent-900">Atualização</p>
              <p className="mt-1 text-sm font-bold text-accent-800">
                {conversation ? formatDateTime(conversation.updatedAt) : "Nova conversa"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <FloatingAssistantChat
        title={selectedConversationId ? selectedTitle : "Agente operacional"}
        subtitle={
          conversation
            ? `${AGENT_ROLE_LABELS[conversation.agentRole]} • ${conversation.channel}`
            : "Operação, onboarding e atendimento."
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-3 p-3">
          {!selectedConversationId ? (
            <>
              <div className="grid gap-2">
                <Select value={newAgentRole} onChange={(e) => setNewAgentRole(e.target.value as AIAgentRole)}>
                  {Object.values(AIAgentRole)
                    .filter((role) => role === AIAgentRole.OPERACIONAL || role === AIAgentRole.ONBOARDING)
                    .map((role) => (
                      <option key={role} value={role}>
                        {AGENT_ROLE_LABELS[role] ?? role}
                      </option>
                    ))}
                </Select>
                <Button size="sm" isLoading={createConversation.isPending} onClick={() => createConversation.mutate()}>
                  Nova conversa
                </Button>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:bg-slate-800/50 dark:border-slate-800">
                {conversations?.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedConversationId(item.id)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-left text-slate-600 transition hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-800 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="line-clamp-1 text-sm font-bold">
                        {item.title || AGENT_ROLE_LABELS[item.agentRole] || item.agentRole}
                      </p>
                      <Badge tone="neutral">{item._count?.messages ?? 0}</Badge>
                    </div>
                    <p className="text-xs text-slate-400">{formatDateTime(item.updatedAt)}</p>
                  </button>
                ))}
                {conversations?.length === 0 && (
                  <AssistantMessage compact content="Crie uma conversa para começar a consultar o agente." />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:bg-slate-800/60 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-bold text-slate-900 dark:text-slate-100">{selectedTitle}</p>
                  {conversation && <p className="text-xs text-slate-500 dark:text-slate-400">{AGENT_ROLE_LABELS[conversation.agentRole]}</p>}
                </div>
                {conversation && <Badge tone="brand">{conversation.channel}</Badge>}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                {loadingConversation && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
                {visibleMessages.map((item) =>
                  item.role === "USER" ? (
                    <UserMessage key={item.id} content={item.content} />
                  ) : (
                    <div key={item.id} className="max-w-[92%]">
                      <AssistantMessage content={item.content} compact />
                    </div>
                  ),
                )}
                {visibleMessages.length === 0 && !loadingConversation && (
                  <AssistantMessage compact content="Envie uma mensagem para começar a conversa com o agente." />
                )}
                <div ref={endRef} />
              </div>

              <form
                className="grid gap-2 sm:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!message.trim()) return;
                  sendMessage.mutate();
                }}
              >
                <Textarea
                  rows={2}
                  className="min-h-[72px] resize-none"
                  placeholder="Ex: resuma os pedidos de hoje"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <Button type="submit" disabled={!message.trim()} isLoading={sendMessage.isPending}>
                  Enviar
                </Button>
              </form>
            </>
          )}
        </div>
      </FloatingAssistantChat>
    </div>
  );
}
