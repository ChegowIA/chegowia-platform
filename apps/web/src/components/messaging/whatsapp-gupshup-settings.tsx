"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { MessagingChannel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GupshupConfiguration = { enabled: boolean };

/** Etapas na ordem em que o empresário as vive. */
const STEPS = [
  {
    title: "Você pede o acesso",
    detail: "Um clique aqui. Nada mais é necessário da sua parte neste momento.",
  },
  {
    title: "Preparamos a conexão sem tirar seu app",
    detail: "Nossa equipe cria a coexistência com o provedor oficial. Costuma levar algumas horas.",
  },
  {
    title: "Você mantém seu WhatsApp conectado",
    detail:
      "Aparece um botão aqui. No cadastro oficial, escolha “usar WhatsApp Business existente” e leia o QR code no app. Não pedimos sua senha em momento nenhum.",
  },
  {
    title: "Pronto para atender",
    detail: "As conversas passam a aparecer na Central de atendimento, com IA e equipe, e o app continua funcionando.",
  },
];

/**
 * WhatsApp na visão do empresário.
 *
 * Ele nunca vê aplicativo, token ou painel do provedor: o caminho é pedir,
 * esperar e conectar. As etapas ficam visíveis desde o começo porque este
 * processo tem espera e passa pelo Facebook dele — descobrir isso no meio gera
 * desconfiança e ticket de suporte.
 */
export function WhatsAppGupshupSettings() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ["whatsapp-gupshup-config"],
    queryFn: async () => (await api.get<GupshupConfiguration>("/messaging/channel/whatsapp/gupshup")).data,
  });
  const { data: channel, isLoading } = useQuery({
    queryKey: ["messaging-channel"],
    queryFn: async () => (await api.get<MessagingChannel>("/messaging/channel")).data,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["messaging-channel"] });

  const requestAccess = useMutation({
    mutationFn: async () => (await api.post<MessagingChannel>("/messaging/channel/whatsapp/request")).data,
    onSuccess: () => {
      setError(null);
      setFeedback("Pedido registrado. Avisaremos aqui quando seu número estiver pronto para conectar.");
      void refresh();
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  /**
   * O empresário conclui o cadastro numa janela do provedor, fora do nosso
   * domínio — não há callback para nós. Por isso a confirmação é sob demanda.
   */
  const checkStatus = useMutation({
    mutationFn: async () => (await api.get<MessagingChannel>("/messaging/channel/whatsapp/gupshup/status")).data,
    onSuccess: (updated) => {
      setError(null);
      setFeedback(
        updated.connected
          ? "Número conectado. Seu atendimento por WhatsApp já está no ar."
          : "O cadastro ainda não foi concluído. Termine o passo a passo na janela e tente de novo.",
      );
      void refresh();
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  if (!config?.enabled) return null;
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando o canal de WhatsApp…</p>
        </CardContent>
      </Card>
    );
  }

  const connected = Boolean(channel?.connected);
  const signupLink = channel?.gupshup?.signupLink ?? null;
  const requested = Boolean(channel?.gupshup?.accessRequestedAt);
  // A etapa atual é derivada do estado real do canal, não de um passo salvo:
  // assim o painel nunca discorda do que já aconteceu.
  const currentStep = connected ? 3 : signupLink ? 2 : requested ? 1 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp da sua empresa</CardTitle>
        {connected ? (
          <Badge tone="success">Conectado</Badge>
        ) : requested ? (
          <Badge tone="warning">Em preparação</Badge>
        ) : (
          <Badge tone="neutral">Não solicitado</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {connected ? (
          <div className="space-y-1">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Seu número <strong>{channel?.number ?? "—"}</strong> está atendendo pela plataforma.
            </p>
            {channel?.gupshup?.connectionMode === "COEXISTENCE" ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Coexistência ativa: o WhatsApp Business App continua disponível. Mensagens enviadas pelo celular também
                entram no histórico da Central como atendimento humano.
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                As conversas aparecem na Central de atendimento. Para manter o app no mesmo número, solicite uma
                reconexão em modo coexistência.
              </p>
            )}
            <p className="pt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
              Avisos de andamento dos pedidos: {channel?.orderNotifications?.configured
                ? "modelo transacional configurado; o cliente pode optar por recebê-los no checkout."
                : "aguardando aprovação e configuração do modelo de mensagem pela ChegowIA. O atendimento normal continua funcionando."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              Conecte o WhatsApp da sua empresa para atender com IA e equipe pela plataforma, sem perder o acesso ao
              WhatsApp Business no celular. São quatro etapas, e a maior parte do trabalho é nossa.
            </p>

            <ol className="space-y-3">
              {STEPS.map((step, index) => {
                const done = index < currentStep;
                const active = index === currentStep;
                return (
                  <li key={step.title} className="flex gap-3">
                    <span
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${
                        done
                          ? "bg-emerald-500 text-white"
                          : active
                            ? "bg-brand-600 text-white"
                            : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                      }`}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          active
                            ? "text-slate-900 dark:text-slate-100"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {step.title}
                      </p>
                      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {currentStep === 2 && (
              <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                <strong>Importante:</strong> escolha <strong>“Connect a WhatsApp Business app”</strong> (ou “usar
                WhatsApp Business existente”) na janela oficial e confirme pelo QR code dentro do app. Não escolha o
                cadastro padrão por SMS para este número; esse é o caminho que o deixa exclusivo da plataforma. Confira
                foto e dados comerciais no app antes de concluir.
              </p>
            )}
          </>
        )}

        {feedback && <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{feedback}</p>}
        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>

      {!connected && currentStep === 0 && (
        <CardActions description="Sem compromisso: você confirma o número em uma etapa posterior.">
          <Button onClick={() => requestAccess.mutate()} isLoading={requestAccess.isPending}>
            Solicitar acesso ao WhatsApp
          </Button>
        </CardActions>
      )}

      {!connected && currentStep === 1 && (
        <CardActions description="Você não precisa fazer nada agora. O botão de conectar aparece aqui quando estiver pronto.">
          <Button variant="outline" onClick={() => refresh()}>
            Atualizar
          </Button>
        </CardActions>
      )}

      {!connected && currentStep === 2 && signupLink && (
        <CardActions description="O cadastro abre em uma janela oficial. Volte aqui depois de concluir.">
          <Button onClick={() => window.open(signupLink, "_blank", "noopener,noreferrer")}>
            Conectar meu WhatsApp
          </Button>
          <Button variant="secondary" onClick={() => checkStatus.mutate()} isLoading={checkStatus.isPending}>
            Já concluí
          </Button>
        </CardActions>
      )}
    </Card>
  );
}
