"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { AIConversation, AIConversationDetail } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { AssistantMessage, UserMessage } from "@/components/ai/assistant-message";
import { FloatingAssistantChat } from "@/components/ai/floating-assistant-chat";

const SUGGESTIONS = [
  "Qual é minha próxima entrega?",
  "Me passa o endereço da próxima",
  "Resumo das minhas entregas",
  "Tem alguma entrega com problema?",
];

export function MotoboyAssistant() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data: conversation, isLoading } = useQuery({
    queryKey: ["motoboy-ai-conversation"],
    queryFn: async () => {
      const { data: started } = await api.post<AIConversation>("/ai/motoboy/conversation");
      const { data } = await api.get<AIConversationDetail>(`/ai/motoboy/conversation/${started.id}`);
      return data;
    },
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      if (!conversation?.id) return;
      await api.post(`/ai/motoboy/conversation/${conversation.id}/messages`, { content });
    },
    onSuccess: () => {
      setError(null);
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["motoboy-ai-conversation"] });
    },
    onError: (err) => setError(apiErrorMessage(err, "Não foi possível consultar o assistente.")),
  });

  const visibleMessages = (conversation?.messages ?? []).filter((item) => item.role !== "TOOL" && item.role !== "SYSTEM");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length, sendMessage.isPending, isLoading]);

  function submit(content: string) {
    const clean = content.trim();
    if (!clean || sendMessage.isPending) return;
    sendMessage.mutate(clean);
  }

  return (
    <FloatingAssistantChat
      title="Assistente de entregas"
      subtitle="Converse sobre suas entregas, rotas, endereços, status, retirada e problemas."
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => submit(item)}
              disabled={sendMessage.isPending || !conversation?.id}
              className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800/60 dark:border-slate-800 dark:text-slate-400"
            >
              {item}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:bg-slate-800/50 dark:border-slate-800">
          {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando conversa...</p>}
          {!isLoading && visibleMessages.length === 0 && (
            <AssistantMessage
              compact
              content={"Estou aqui para te ajudar com suas entregas. Pode perguntar sobre próxima rota, endereço, cliente, status ou problema."}
            />
          )}
          {visibleMessages.map((item) =>
            item.role === "USER" ? (
              <UserMessage key={item.id} content={item.content} />
            ) : (
              <div key={item.id} className="max-w-[92%]">
                <AssistantMessage content={item.content} compact />
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            submit(message);
          }}
        >
          <Textarea
            rows={2}
            className="min-h-[72px] resize-none"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Digite sua pergunta sobre entregas..."
          />
          <Button type="submit" disabled={!message.trim() || !conversation?.id} isLoading={sendMessage.isPending}>
            Enviar
          </Button>
        </form>
      </div>
    </FloatingAssistantChat>
  );
}
