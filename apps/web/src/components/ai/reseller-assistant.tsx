"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AIMessageRole } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { AssistantMessage, UserMessage } from "@/components/ai/assistant-message";
import { FloatingAssistantChat } from "@/components/ai/floating-assistant-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

/** Um chat de assistente só renderiza turnos do usuário e do agente; SYSTEM e TOOL não chegam aqui. */
type Message = { id: string; role: AIMessageRole.USER | AIMessageRole.ASSISTANT; content: string };

const SUGGESTIONS = [
  "Resuma minha carteira",
  "Como funciona minha comissão?",
  "Ajude a abordar meu próximo lead",
];

export function ResellerAssistant() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async (content: string) => (await api.post<{ content: string }>("/resellers/me/assistant", { message: content })).data,
    onMutate: (content) => {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: AIMessageRole.USER, content }]);
      setMessage("");
      setError(null);
    },
    onSuccess: (data) => setMessages((current) => [...current, { id: crypto.randomUUID(), role: AIMessageRole.ASSISTANT, content: data.content }]),
    onError: (cause) => setError(apiErrorMessage(cause, "Não foi possível consultar o assistente comercial.")),
  });

  function submit(content: string) {
    const clean = content.trim();
    if (clean && !send.isPending) send.mutate(clean);
  }

  return (
    <FloatingAssistantChat
      title="Assistente de vendas"
      subtitle="Carteira, comissão e próximos contatos."
      triggerEyebrow="Parceiro ChegowIA"
      triggerLabel="Apoio para vender"
    >
      <div className="flex h-full min-h-0 flex-col bg-slate-50/70 p-3 dark:bg-slate-800/50">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-3 dark:bg-slate-900 dark:border-slate-800">
          {messages.length === 0 && (
            <>
              <AssistantMessage compact content="Olá! Posso ajudar a organizar seus contatos, preparar uma abordagem e explicar sua comissão ou saldo." />
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => submit(suggestion)} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-2 text-left text-xs font-bold text-brand-700 transition hover:bg-brand-600 hover:text-white">
                    {suggestion}
                  </button>
                ))}
              </div>
            </>
          )}
          {messages.map((item) => item.role === AIMessageRole.USER ? <UserMessage key={item.id} content={item.content} /> : <AssistantMessage key={item.id} compact content={item.content} />)}
          {send.isPending && <AssistantMessage compact content="Analisando sua carteira..." />}
        </div>
        {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        <form className="mt-3 flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:bg-slate-900 dark:border-slate-800" onSubmit={(event) => { event.preventDefault(); submit(message); }}>
          <Textarea rows={2} className="min-h-[46px] flex-1 resize-none border-0 px-2 py-2 shadow-none focus:ring-0" placeholder="Como posso ajudar na próxima venda?" value={message} onChange={(event) => setMessage(event.target.value)} />
          <Button type="submit" aria-label="Enviar" className="h-11 w-11 shrink-0 rounded-full px-0 text-lg" disabled={!message.trim() || send.isPending}>↑</Button>
        </form>
      </div>
    </FloatingAssistantChat>
  );
}
