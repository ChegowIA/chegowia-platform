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
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-500">Validando sua sessão...</p>
          </div>
        </div>
      ) : !user ? (
        <div className="p-3">
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
            <p className="text-sm font-medium text-brand-900">Entre como cliente para conversar com a IA desta loja.</p>
            <div className="mt-3 flex gap-2">
              <Link href="/login" className="flex-1">
                <Button variant="outline" className="w-full">
                  Entrar
                </Button>
              </Link>
              <Link href="/cadastro" className="flex-1">
                <Button className="w-full">Criar conta</Button>
              </Link>
            </div>
          </div>
        </div>
      ) : !canChat ? (
        <div className="p-3">
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
            <p className="text-sm font-medium text-brand-900">O assistente da loja é exclusivo para contas de cliente.</p>
            <Link href={homePathForRole(user.role)} className="mt-3 block">
              <Button variant="outline" className="w-full">
                Ir para o painel
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3 p-3">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-3">
            {isLoading && <p className="text-sm text-slate-500">Carregando conversa...</p>}
            {visibleMessages.map((item) =>
              item.role === "USER" ? (
                <UserMessage key={item.id} content={item.content} />
              ) : (
                <AssistantMessage key={item.id} content={item.content} compact />
              ),
            )}
            {visibleMessages.length === 0 && !isLoading && (
              <AssistantMessage
                compact
                content="Pode perguntar sobre produtos, valores, entrega, formas de pagamento ou sugestões do cardápio."
              />
            )}
            <div ref={endRef} />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <form
            className="grid gap-2 sm:grid-cols-[1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Textarea
              rows={2}
              className="min-h-[72px] resize-none"
              placeholder="Digite sua pergunta..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              type="submit"
              disabled={!message.trim()}
              isLoading={sendMessage.isPending || startConversation.isPending}
            >
              Enviar
            </Button>
          </form>
        </div>
      )}
    </FloatingAssistantChat>
  );
}
