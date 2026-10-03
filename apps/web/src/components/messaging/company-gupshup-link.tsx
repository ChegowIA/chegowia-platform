"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { MessagingChannel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/input";
import { GupshupCallbackUrls } from "@/components/messaging/gupshup-callback-urls";

type ConnectionMode = "COEXISTENCE" | "PLATFORM_ONLY";

const EMPTY_FORM: { appName: string; appId: string; signupLink: string; number: string; connectionMode: ConnectionMode } = {
  appName: "",
  appId: "",
  signupLink: "",
  number: "",
  // Números novos devem preservar o aplicativo por padrão. A opção exclusiva
  // continua disponível para uma linha que nunca esteve no WhatsApp Business.
  connectionMode: "COEXISTENCE",
};

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
  useEffect(() => {
    if (!channel) return;
    setForm({
      appName: channel.gupshup?.appName ?? "",
      appId: channel.gupshup?.appId ?? "",
      signupLink: channel.gupshup?.signupLink ?? "",
      number: channel.number ?? "",
      // Não declaramos coexistência para um canal antigo só porque o campo ainda
      // não existia. Para vínculo já iniciado, o operador decide conscientemente.
      connectionMode: channel.gupshup?.connectionMode
        ?? (channel.gupshup?.appId ? "PLATFORM_ONLY" : "COEXISTENCE"),
    });
  }, [channel]);

  const save = useMutation({
    mutationFn: async () => {
      return (await api.put<MessagingChannel>(`/messaging/companies/${companyId}/whatsapp/gupshup`, {
        appName: form.appName.trim(),
        appId: form.appId.trim() || undefined,
        signupLink: form.signupLink.trim() || undefined,
        number: form.number.trim() || undefined,
        connectionMode: form.connectionMode,
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
        {/* O pedido é o gatilho do trabalho manual: sem destacá-lo, o superadmin
            só descobre que alguém espera quando o cliente cobra. */}
        {channel?.gupshup?.accessRequestedAt && !channel.connected && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Esta empresa solicitou o WhatsApp
            </p>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              Pedido em {new Date(channel.gupshup.accessRequestedAt).toLocaleString("pt-BR")}. Crie o
              aplicativo no Gupshup e traga os dados abaixo para liberar o botão de conexão no painel dela.
            </p>
          </div>
        )}

        <p className="text-sm text-slate-600 dark:text-slate-300">
          Crie o aplicativo no painel do Gupshup, copie o link de <strong>Direct Facebook Registration</strong> e
          cole aqui. O empresário conclui o cadastro com o Facebook dele, sem passar suas credenciais.
        </p>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <strong>Para manter o celular:</strong> no fluxo oficial, escolha <strong>“Connect a WhatsApp Business app”</strong>
          (ou “usar WhatsApp Business existente”) e confirme pelo QR code dentro do aplicativo <strong>WhatsApp Business</strong>.
          Não use o cadastro padrão por SMS para um número que já está no app, pois ele o deixa exclusivo da plataforma.
          Confira também a foto e os dados comerciais no app antes de concluir, pois a Meta pode restringir a troca da foto
          após o onboarding em coexistência.
        </div>

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
          <FormField label="Modo da conexão">
            <Select
              value={form.connectionMode}
              onChange={(event) => setForm((current) => ({ ...current, connectionMode: event.target.value as ConnectionMode }))}
            >
              <option value="COEXISTENCE">Manter WhatsApp Business App (recomendado)</option>
              <option value="PLATFORM_ONLY">Somente pela ChegowIA</option>
            </Select>
          </FormField>
          <FormField label="Número (preencha após o cadastro concluir)">
            <Input
              value={form.number}
              placeholder="5562999990000"
              onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))}
            />
          </FormField>
        </div>

        <GupshupCallbackUrls />

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
