"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/input";
import { GupshupCallbackUrls } from "@/components/messaging/gupshup-callback-urls";

type PlatformChannelGupshup = {
  connected: boolean;
  provider: "META" | "GUPSHUP";
  number?: string | null;
  gupshup: { appId?: string | null; appName?: string | null; signupLink?: string | null };
};

const EMPTY_FORM = { appName: "", appId: "", signupLink: "", number: "" };

/**
 * Conexão do número institucional da ChegowIA pelo Gupshup.
 *
 * É o irmão de CompanyGupshupLink, mas para o canal da própria plataforma, que
 * vive em tabelas separadas justamente para não atravessar o isolamento dos
 * tenants. Some quando o Gupshup não está habilitado nesta instalação.
 */
export function PlatformGupshupLink() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ["whatsapp-gupshup-config"],
    queryFn: async () =>
      (await api.get<{ enabled: boolean; callbackUrl: string | null }>("/messaging/channel/whatsapp/gupshup")).data,
  });
  const { data: channel } = useQuery({
    queryKey: ["platform-whatsapp-channel"],
    queryFn: async () => (await api.get<PlatformChannelGupshup>("/platform/whatsapp/channel")).data,
  });

  useEffect(() => {
    if (!channel) return;
    setForm({
      appName: channel.gupshup?.appName ?? "",
      appId: channel.gupshup?.appId ?? "",
      signupLink: channel.gupshup?.signupLink ?? "",
      number: channel.number ?? "",
    });
  }, [channel]);

  const save = useMutation({
    mutationFn: async () => {
      return (await api.put<PlatformChannelGupshup>("/platform/whatsapp/channel/gupshup", {
        appName: form.appName.trim(),
        appId: form.appId.trim() || undefined,
        signupLink: form.signupLink.trim() || undefined,
        number: form.number.trim() || undefined,
      })).data;
    },
    onSuccess: (updated) => {
      setError(null);
      setFeedback(
        updated.connected
          ? "Número institucional conectado pelo Gupshup."
          : "Aplicativo vinculado. Informe o número quando o cadastro concluir para ativar.",
      );
      void queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-channel"] });
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  if (!config?.enabled) return null;

  const usingGupshup = channel?.provider === "GUPSHUP";

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp institucional pelo Gupshup</CardTitle>
        {usingGupshup && channel?.connected ? (
          <Badge tone="success">Conectado</Badge>
        ) : (
          <Badge tone="warning">Pendente</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Alternativa à Meta para o número comercial da ChegowIA. Crie o aplicativo no painel do Gupshup, cole a
          URL de callback lá e traga o nome e o id para cá.
        </p>

        <GupshupCallbackUrls />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Nome do aplicativo no Gupshup">
            <Input
              value={form.appName}
              placeholder="chegowiainstitucional"
              onChange={(event) => setForm((current) => ({ ...current, appName: event.target.value }))}
            />
          </FormField>
          <FormField label="App ID">
            <Input
              value={form.appId}
              onChange={(event) => setForm((current) => ({ ...current, appId: event.target.value }))}
            />
          </FormField>
          <FormField label="Link de cadastro (Direct Facebook Registration)">
            <Input
              value={form.signupLink}
              placeholder="https://"
              onChange={(event) => setForm((current) => ({ ...current, signupLink: event.target.value }))}
            />
          </FormField>
          <FormField label="Número (preencha após concluir o cadastro)">
            <Input
              value={form.number}
              placeholder="5562999990000"
              onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))}
            />
          </FormField>
        </div>

        {feedback && <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{feedback}</p>}
        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>

      <CardActions description="Salvar troca o provedor deste canal para o Gupshup. A configuração da Meta é preservada.">
        <Button
          onClick={() => save.mutate()}
          isLoading={save.isPending}
          disabled={save.isPending || form.appName.trim().length < 2}
        >
          Salvar vínculo
        </Button>
      </CardActions>
    </Card>
  );
}
