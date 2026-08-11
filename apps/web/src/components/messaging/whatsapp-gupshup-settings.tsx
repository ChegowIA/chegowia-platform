"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { MessagingChannel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GupshupConfiguration = {
  enabled: boolean;
  mode: "SELF_SERVE" | "PARTNER";
  automaticOnboarding: boolean;
  reason: string | null;
};

/**
 * Conexão do WhatsApp pelo Gupshup na visão do empresário.
 *
 * Ele nunca vê app id, token ou painel do BSP: ou aparece o botão que abre o
 * cadastro oficial (onde ele entra com o Facebook dele), ou o aviso de que a
 * plataforma ainda está preparando o número. Quem prepara o aplicativo é o
 * superadmin, do outro lado.
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

  /**
   * O empresário conclui o cadastro numa janela da Meta, fora do nosso domínio —
   * não há callback para nós. Por isso a confirmação é sob demanda: ele volta e
   * clica em "Já concluí", e aí consultamos o estado real do número.
   */
  const checkStatus = useMutation({
    mutationFn: async () => (await api.get<MessagingChannel>("/messaging/channel/whatsapp/gupshup/status")).data,
    onSuccess: (updated) => {
      setError(null);
      setFeedback(
        updated.connected
          ? "Número conectado. Seu atendimento por WhatsApp já está no ar."
          : "O cadastro ainda não foi concluído na Meta. Termine o passo a passo na janela e tente de novo.",
      );
      void queryClient.invalidateQueries({ queryKey: ["messaging-channel"] });
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

  const isGupshup = channel?.provider === "GUPSHUP";
  const signupLink = channel?.gupshup?.signupLink ?? null;
  const connected = Boolean(channel?.connected);

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp da sua empresa</CardTitle>
        {connected ? <Badge tone="success">Conectado</Badge> : <Badge tone="neutral">Não conectado</Badge>}
      </CardHeader>

      <CardContent className="space-y-4">
        {connected ? (
          <div className="space-y-1">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Seu número <strong>{channel?.number ?? "—"}</strong> está atendendo pela plataforma.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              As conversas aparecem na Central de atendimento e o perfil do WhatsApp é editado aqui no painel.
            </p>
          </div>
        ) : signupLink ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Falta um passo: conectar seu número. Você vai entrar com o Facebook da sua empresa e confirmar o
              número por SMS.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Depois de conectar, o número passa a ser atendido por aqui e sai do aplicativo WhatsApp Business.
              Se ele estiver em outra plataforma, desative a verificação em duas etapas antes de começar.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Estamos preparando o cadastro do seu número. Assim que estiver pronto, o botão de conexão aparece
            aqui.
          </p>
        )}

        {feedback && <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{feedback}</p>}
        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>

      {!connected && signupLink && (
        <CardActions description="O cadastro abre em uma janela oficial da Meta. Volte aqui depois de concluir.">
          <Button onClick={() => window.open(signupLink, "_blank", "noopener,noreferrer")}>
            Conectar meu WhatsApp
          </Button>
          <Button
            variant="secondary"
            onClick={() => checkStatus.mutate()}
            disabled={checkStatus.isPending || !isGupshup}
          >
            {checkStatus.isPending ? "Verificando…" : "Já concluí"}
          </Button>
        </CardActions>
      )}
    </Card>
  );
}
