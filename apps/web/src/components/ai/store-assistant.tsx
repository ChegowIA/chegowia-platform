"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { homePathForRole } from "@/lib/auth-routes";
import { AIConversation, AIConversationDetail } from "@/lib/types";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { AssistantMessage, UserMessage } from "@/components/ai/assistant-message";
import { FloatingAssistantChat } from "@/components/ai/floating-assistant-chat";

export function StoreAssistant({ slug, companyName }: { slug: string; companyName: string }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const canChat = user?.role === Role.CLIENTE;

  const { data: conversation, isLoading } = useQuery({
    queryKey: ["store-ai-conversation", slug, conversationId],
    queryFn: async () => {
      const { data } = await api.get<AIConversationDetail>(`/ai/public/${slug}/conversations/${conversationId}`);
      return data;
    },
    enabled: !!conversationId && canChat,
  });

  const startConversation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<AIConversation>(`/ai/public/${slug}/conversations`);
      return data;
    },
  });

  const sendMessage = useMutation({
    mutationFn: async () => {
      let id = conversationId;
      if (!id) {
        const created = await startConversation.mutateAsync();
        id = created.id;
      }
      await api.post(`/ai/public/${slug}/conversations/${id}/messages`, { content: message });
      return id;
    },
    onSuccess: (id) => {
      setError(null);
      setConversationId(id);
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["store-ai-conversation", slug, id] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const visibleMessages = (conversation?.messages ?? []).filter((item) => item.role !== "TOOL" && item.role !== "SYSTEM");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length, sendMessage.isPending, isLoading]);

  function submit() {
    if (!message.trim() || sendMessage.isPending || startConversation.isPending) return;
    sendMessage.mutate();
  }

  return (
    <FloatingAssistantChat
      title="Assistente da loja"
      subtitle={`${companyName}: produtos, valores, entrega e formas de pagamento.`}
    >
      {!hasHydrated || isSessionLoading ? (
        <div className="p-3">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:bg-slate-800/60 dark:border-slate-800">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Validando sua sessão...</p>
          </div>
        </div>
      ) : !user ? (
        <div className="p-3">
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-3 dark:bg-brand-950/30 dark:border-brand-900/50">
            <p className="text-sm font-medium text-brand-900 dark:text-brand-200">Entre como cliente para conversar com a IA desta loja.</p>
            <div className="mt-3 flex gap-2">
              <Link href="/acesso" className="flex-1">
                <Button variant="outline" className="w-full">
                  Entrar
                </Button>
              </Link>
              <Link href="/acesso?modo=cadastro" className="flex-1">
                <Button className="w-full">Criar conta</Button>
              </Link>
            </div>
          </div>
        </div>
      ) : !canChat ? (
        <div className="p-3">
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-3 dark:bg-brand-950/30 dark:border-brand-900/50">
            <p className="text-sm font-medium text-brand-900 dark:text-brand-200">O assistente da loja é exclusivo para contas de cliente.</p>
            <Link href={homePathForRole(user.role)} className="mt-3 block">
              <Button variant="outline" className="w-full">
                Ir para o painel
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3 p-3">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:bg-slate-800/50 dark:border-slate-800">
            {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando conversa...</p>}
            {visibleMessages.map((item) =>
              item.role === "USER" ? (
                <UserMessage key={item.id} content={item.content} />
              ) : (
                <AssistantMessage key={item.id} content={item.content} compact />
              ),
            )}
            {visibleMessages.length === 0 && !isLoading && (
              <>
                <AssistantMessage
                  compact
                  content={`Oi! Eu sou o assistente da ${companyName}. Posso te ajudar a escolher algo gostoso ou tirar dúvidas sobre seu pedido.`}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  {["O que vocês mais vendem?", "Quero uma sugestão", "Como funciona a entrega?"].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setMessage(suggestion)}
                      className="rounded-full border border-brand-200 bg-white px-3 py-2 text-left text-xs font-bold text-brand-700 transition hover:border-brand-600 hover:bg-brand-600 hover:text-white"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div ref={endRef} />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

          <form
            className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100 dark:bg-slate-900 dark:border-slate-800"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Textarea
              rows={2}
              className="min-h-[46px] flex-1 resize-none border-0 px-2 py-2 shadow-none focus:ring-0"
              placeholder="Escreva sua mensagem..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              type="submit"
              disabled={!message.trim()}
              isLoading={sendMessage.isPending || startConversation.isPending}
              className="h-11 w-11 shrink-0 rounded-full px-0"
              aria-label="Enviar mensagem"
            >
              <span aria-hidden="true" className="text-lg">↑</span>
            </Button>
          </form>
        </div>
      )}
    </FloatingAssistantChat>
  );
}
