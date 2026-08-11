"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { MessagingChannel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/input";

const EMPTY_FORM = { appName: "", appId: "", signupLink: "", number: "" };

/**
 * Vínculo do aplicativo do Gupshup a uma empresa, na área do superadmin.
 *
 * No modo self-serve não existe API para criar o aplicativo por cliente: quem
 * cria no painel do Gupshup é o superadmin, e traz para cá o nome, o id e o link
 * de cadastro. O empresário nunca vê nada disso — do lado dele aparece só o
 * botão "Conectar meu WhatsApp" apontando para esse link.
 */
export function CompanyGupshupLink({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: channel } = useQuery({
    queryKey: ["super-admin-company-channel", companyId],
    queryFn: async () => (await api.get<MessagingChannel>(`/messaging/companies/${companyId}/whatsapp`)).data,
  });
  const { data: config } = useQuery({
    queryKey: ["whatsapp-gupshup-config"],
    queryFn: async () => (await api.get<{ callbackUrl: string | null }>("/messaging/channel/whatsapp/gupshup")).data,
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
      return (await api.put<MessagingChannel>(`/messaging/companies/${companyId}/whatsapp/gupshup`, {
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
          ? "Aplicativo vinculado e canal ativo."
          : "Aplicativo vinculado. O canal ativa quando o número concluir o cadastro.",
      );
      void queryClient.invalidateQueries({ queryKey: ["super-admin-company-channel", companyId] });
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp pelo Gupshup</CardTitle>
        {channel?.connected ? <Badge tone="success">Conectado</Badge> : <Badge tone="warning">Pendente</Badge>}
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Crie o aplicativo no painel do Gupshup, copie o link de <strong>Direct Facebook Registration</strong> e
          cole aqui. O empresário conclui o cadastro com o Facebook dele, sem passar suas credenciais.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Nome do aplicativo no Gupshup">
            <Input
              value={form.appName}
              placeholder="chegowiaempresa1"
              onChange={(event) => setForm((current) => ({ ...current, appName: event.target.value }))}
            />
          </FormField>
          <FormField label="App ID (necessário para editar o perfil)">
            <Input
              value={form.appId}
              onChange={(event) => setForm((current) => ({ ...current, appId: event.target.value }))}
            />
          </FormField>
          <FormField label="Link de cadastro do cliente">
            <Input
              value={form.signupLink}
              placeholder="https://"
              onChange={(event) => setForm((current) => ({ ...current, signupLink: event.target.value }))}
            />
          </FormField>
          <FormField label="Número (preencha após o cadastro concluir)">
            <Input
              value={form.number}
              placeholder="5562999990000"
              onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))}
            />
          </FormField>
        </div>

        {config?.callbackUrl && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Cole esta URL de callback no aplicativo, dentro do painel do Gupshup:
            </p>
            <code className="mt-1 block break-all text-xs text-slate-500 dark:text-slate-400">
              {config.callbackUrl}
            </code>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Sem isso as mensagens recebidas não chegam na Central de atendimento.
            </p>
          </div>
        )}

        {feedback && <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{feedback}</p>}
        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>

      <CardActions description="O nome do aplicativo é único: é por ele que o webhook do Gupshup encontra esta empresa.">
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
