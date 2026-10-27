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
  const [template, setTemplate] = useState({ templateId: "", templateName: "", languageCode: "pt_BR" });
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
    setTemplate({
      templateId: channel.orderNotifications?.templateId ?? "",
      templateName: channel.orderNotifications?.templateName ?? "",
      languageCode: channel.orderNotifications?.languageCode ?? "pt_BR",
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
          : "Aplicativo vinculado. Quando o cliente concluir o cadastro e o app estiver Live, preencha o número para ativar.",
      );
      void queryClient.invalidateQueries({ queryKey: ["super-admin-company-channel", companyId] });
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  const saveTemplate = useMutation({
    mutationFn: async () => (await api.put<MessagingChannel>(`/messaging/companies/${companyId}/whatsapp/order-notifications`, template)).data,
    onSuccess: () => {
      setError(null);
      setFeedback("Modelo de avisos de pedido salvo.");
      void queryClient.invalidateQueries({ queryKey: ["super-admin-company-channel", companyId] });
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  const syncTemplate = useMutation({
    mutationFn: async () => (await api.post<MessagingChannel>(`/messaging/companies/${companyId}/whatsapp/order-notifications/sync`)).data,
    onSuccess: (updated) => {
      setError(null);
      setFeedback(updated.orderNotifications?.configured
        ? "Modelo de avisos aprovado e vinculado ao aplicativo."
        : "Modelo solicitado para este aplicativo. Aguardando aprovação da Meta; o sistema verificará automaticamente.");
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
        {/* O "Já concluí" do empresário: é a vez da equipe ativar o número. */}
        {channel?.gupshup?.signupCompletedAt && !channel.connected && (
          <div className="rounded-2xl border border-sky-300 bg-sky-50 p-3 dark:border-sky-900/60 dark:bg-sky-950/30">
            <p className="text-sm font-bold text-sky-900 dark:text-sky-200">
              O cliente concluiu o cadastro: falta ativar
            </p>
            <p className="mt-1 text-xs leading-5 text-sky-800 dark:text-sky-300">
              Avisado em {new Date(channel.gupshup.signupCompletedAt).toLocaleString("pt-BR")}. No painel do Gupshup, confira
              se o aplicativo está <strong>Live</strong> e qual é o número. Depois preencha o número e o App ID abaixo e
              salve: é isso que libera o atendimento no painel da empresa.
            </p>
          </div>
        )}

        {channel?.gupshup?.accessRequestedAt && !channel.connected && !channel.gupshup.signupCompletedAt && (
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
          <FormField label="App ID (obrigatório para ativar)">
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
          <FormField label="Número (só depois que o app estiver Live)">
            <Input
              value={form.number}
              placeholder="5562999990000"
              onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))}
            />
          </FormField>
        </div>

        <GupshupCallbackUrls />

        {channel?.gupshup?.appName && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-slate-900 dark:text-slate-100">Avisos de andamento do pedido</p>
              <Badge tone={channel.orderNotifications?.configured ? "success" : "warning"}>{channel.orderNotifications?.configured ? "Modelo configurado" : "Modelo pendente"}</Badge>
            </div>
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
              O modelo padrão ChegowIA é enviado ao WABA desta loja e só libera os avisos depois da aprovação da Meta. Cada aplicativo precisa ter o próprio ID aprovado; não é possível usar o ID de outra empresa. Corpo: “Olá {"{{1}}"}! Seu pedido #{"{{2}}"} em {"{{3}}"} está {"{{4}}"}. Se precisar de ajuda, responda esta mensagem.”
            </p>
            {channel.orderNotifications?.state && (
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Situação no Gupshup: {channel.orderNotifications.state === "APPROVED" ? "aprovado" : channel.orderNotifications.state === "PENDING" ? "aguardando aprovação" : channel.orderNotifications.state === "MANUAL" ? "configuração manual" : channel.orderNotifications.state}.
              </p>
            )}
            {channel.orderNotifications?.error && <p className="text-xs text-red-700 dark:text-red-300">{channel.orderNotifications.error}</p>}
            <Button type="button" isLoading={syncTemplate.isPending} disabled={!channel.connected || !channel.gupshup?.appId} onClick={() => syncTemplate.mutate()}>
              Criar ou sincronizar modelo padrão
            </Button>
            <p className="text-xs text-slate-500 dark:text-slate-400">O vínculo manual abaixo fica para modelos já aprovados ou casos excepcionais.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <FormField label="ID no Gupshup self-serve"><Input value={template.templateId} onChange={(event) => setTemplate((current) => ({ ...current, templateId: event.target.value }))} /></FormField>
              <FormField label="Nome no modo partner"><Input value={template.templateName} onChange={(event) => setTemplate((current) => ({ ...current, templateName: event.target.value }))} /></FormField>
              <FormField label="Idioma"><Input value={template.languageCode} onChange={(event) => setTemplate((current) => ({ ...current, languageCode: event.target.value }))} /></FormField>
            </div>
            <Button type="button" variant="secondary" isLoading={saveTemplate.isPending} onClick={() => saveTemplate.mutate()}>Salvar modelo de avisos</Button>
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
