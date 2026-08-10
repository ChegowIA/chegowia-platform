"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { MessagingChannel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input, Textarea } from "@/components/ui/input";

type EmbeddedSignupEvent =
  | "FINISH"
  | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
  | "FINISH_OBO_MIGRATION"
  | "FINISH_GRANT_ONLY_API_ACCESS";

type EmbeddedSignupConfiguration = {
  enabled: boolean;
  appId: string | null;
  configurationId: string | null;
  graphApiVersion: string;
  reason: string | null;
};

type SignupAssets = {
  phoneNumberId: string;
  businessAccountId: string;
  businessPortfolioId?: string;
  event: EmbeddedSignupEvent;
};

type FacebookSdk = {
  init: (settings: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } } | undefined) => void,
    settings: Record<string, unknown>,
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

const META_SDK_SCRIPT_ID = "chegowia-meta-sdk";
const FINISH_EVENTS = new Set<EmbeddedSignupEvent>([
  "FINISH",
  "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  "FINISH_OBO_MIGRATION",
  "FINISH_GRANT_ONLY_API_ACCESS",
]);
const WHATSAPP_BUSINESS_APP_COEXISTENCE_FEATURE = "whatsapp_business_app_onboarding";
let facebookSdkPromise: Promise<FacebookSdk> | null = null;

/**
 * Painel para empresários: o único caminho visível é o popup oficial da Meta.
 * IDs, token e PIN ficam no backend e o formulário legado fica recolhido para
 * casos de suporte/migração.
 */
export function WhatsAppCloudSettings() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualMigrationAcknowledged, setManualMigrationAcknowledged] = useState(false);
  const [signupState, setSignupState] = useState<"idle" | "opening" | "waiting" | "connecting">("idle");
  const signupCode = useRef<string | null>(null);
  const signupAssets = useRef<SignupAssets | null>(null);
  const signupCompletionStarted = useRef(false);
  const [form, setForm] = useState({
    phoneNumberId: "",
    businessAccountId: "",
    accessToken: "",
    automationEnabled: true,
    welcomeMessage: "",
    fallbackNumber: "",
  });
  const { data: channel, isLoading: isLoadingChannel } = useQuery({
    queryKey: ["messaging-channel"],
    queryFn: async () => (await api.get<MessagingChannel>("/messaging/channel")).data,
  });
  const { data: signupConfig, isLoading: isLoadingSignupConfig } = useQuery({
    queryKey: ["whatsapp-embedded-signup"],
    queryFn: async () => (await api.get<EmbeddedSignupConfiguration>("/messaging/channel/whatsapp/embedded-signup")).data,
  });

  useEffect(() => {
    if (!channel) return;
    setForm((current) => ({
      ...current,
      phoneNumberId: channel.integration.phoneNumberId ?? "",
      businessAccountId: channel.integration.businessAccountId ?? "",
      automationEnabled: channel.automationEnabled,
      welcomeMessage: channel.welcomeMessage ?? "",
      fallbackNumber: channel.number ?? "",
    }));
  }, [channel]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["messaging-channel"] });
    void queryClient.invalidateQueries({ queryKey: ["company-me"] });
  }, [queryClient]);

  const connectManually = useMutation({
    mutationFn: async () => (await api.put<MessagingChannel>("/messaging/channel/whatsapp/cloud", {
      phoneNumberId: form.phoneNumberId,
      businessAccountId: form.businessAccountId || undefined,
      accessToken: form.accessToken,
      automationEnabled: form.automationEnabled,
      welcomeMessage: form.welcomeMessage || undefined,
    })).data,
    onSuccess: () => {
      setError(null);
      setFeedback("Número conectado com segurança. O token não fica visível no painel.");
      setForm((current) => ({ ...current, accessToken: "" }));
      refresh();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const completeEmbeddedSignup = useMutation({
    mutationFn: async (payload: SignupAssets & { code: string }) => {
      return (await api.post<MessagingChannel>("/messaging/channel/whatsapp/embedded-signup", payload)).data;
    },
    onSuccess: () => {
      setError(null);
      setFeedback("Tudo pronto: seu WhatsApp está conectado para atender com IA e equipe. O WhatsApp Business App continua sendo o canal do dia a dia quando a Meta concluir o vínculo de coexistência.");
      setSignupState("idle");
      refresh();
    },
    onError: (cause) => {
      setSignupState("idle");
      setError(apiErrorMessage(cause, "Não foi possível concluir a conexão com a Meta. Tente novamente."));
    },
  });

  const saveAutomation = useMutation({
    mutationFn: async () => (await api.patch<MessagingChannel>("/messaging/channel/whatsapp/automation", {
      automationEnabled: form.automationEnabled,
      welcomeMessage: form.welcomeMessage || undefined,
    })).data,
    onSuccess: () => {
      setError(null);
      setFeedback("Automação de atendimento atualizada.");
      refresh();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const saveFallbackNumber = useMutation({
    mutationFn: async () => (await api.patch<MessagingChannel>("/messaging/channel/whatsapp", {
      number: form.fallbackNumber,
    })).data,
    onSuccess: () => {
      setError(null);
      setFeedback("Número usado nos links do site atualizado.");
      refresh();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const tryCompleteEmbeddedSignup = useCallback(() => {
    const code = signupCode.current;
    const assets = signupAssets.current;
    if (!code || !assets || signupCompletionStarted.current) return;
    signupCompletionStarted.current = true;
    setSignupState("connecting");
    completeEmbeddedSignup.mutate({ code, ...assets });
  }, [completeEmbeddedSignup]);

  useEffect(() => {
    const onMetaMessage = (message: MessageEvent<unknown>) => {
      if (!isMetaOrigin(message.origin)) return;
      const payload = parseMetaMessage(message.data);
      if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP") return;

      const event = String(payload.event ?? "");
      if (event === "CANCEL") {
        setSignupState("idle");
        setFeedback("A conexão foi cancelada. Quando quiser, clique em conectar novamente.");
        return;
      }
      if (event === "FINISH_ONLY_WABA") {
        setSignupState("idle");
        setError("A Meta autorizou a conta, mas nenhum número foi escolhido. Selecione ou cadastre um número no próximo passo.");
        return;
      }
      if (!FINISH_EVENTS.has(event as EmbeddedSignupEvent)) return;

      const data = asRecord(payload.data);
      const phoneNumberId = stringValue(data?.phone_number_id);
      const businessAccountId = stringValue(data?.waba_id);
      if (!phoneNumberId || !businessAccountId) {
        setSignupState("idle");
        setError("A Meta não informou o número selecionado. Feche e refaça a conexão.");
        return;
      }
      signupAssets.current = {
        phoneNumberId,
        businessAccountId,
        businessPortfolioId: stringValue(data?.business_id) || undefined,
        event: event as EmbeddedSignupEvent,
      };
      setSignupState("waiting");
      tryCompleteEmbeddedSignup();
    };
    window.addEventListener("message", onMetaMessage);
    return () => window.removeEventListener("message", onMetaMessage);
  }, [tryCompleteEmbeddedSignup]);

  const startEmbeddedSignup = async () => {
    if (!signupConfig?.enabled || !signupConfig.appId || !signupConfig.configurationId) return;
    setError(null);
    setFeedback(null);
    signupCode.current = null;
    signupAssets.current = null;
    signupCompletionStarted.current = false;
    setSignupState("opening");
    try {
      const facebook = await loadFacebookSdk(signupConfig.appId, signupConfig.graphApiVersion);
      setSignupState("waiting");
      facebook.login((response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setSignupState("idle");
          setFeedback("A conexão não foi concluída. Você pode tentar novamente quando quiser.");
          return;
        }
        signupCode.current = code;
        tryCompleteEmbeddedSignup();
      }, {
        config_id: signupConfig.configurationId,
        response_type: "code",
        override_default_response_type: true,
        // Solicita à Meta o fluxo de coexistência: o mesmo número segue ativo no
        // WhatsApp Business App e também pode atender pelo ChegowIA. Não usamos o
        // cadastro padrão de Cloud API, que pode migrar o número para fora do app.
        extras: {
          setup: {},
          featureType: WHATSAPP_BUSINESS_APP_COEXISTENCE_FEATURE,
        },
      });
    } catch {
      setSignupState("idle");
      setError("Não foi possível abrir a tela segura da Meta. Verifique sua conexão e tente novamente.");
    }
  };

  const readyForManualConnection = Boolean(form.phoneNumberId.trim() && form.businessAccountId.trim() && form.accessToken.trim());
  const signupBusy = signupState !== "idle" || completeEmbeddedSignup.isPending;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white dark:border-slate-800 dark:from-emerald-950/40 dark:to-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">WhatsApp da empresa</p>
            <CardTitle className="mt-1">Conecte sem sair do WhatsApp Business App</CardTitle>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Seus clientes poderão escolher entre o atendente virtual e sua equipe, enquanto sua equipe continua usando o WhatsApp Business App no celular.
            </p>
          </div>
          <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-black ${channel?.connected ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
            {channel?.connected ? "WhatsApp conectado" : "Pronto para conectar"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
        {feedback && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{feedback}</p>}

        {isLoadingChannel ? <p className="text-sm text-slate-500 dark:text-slate-400">Carregando WhatsApp...</p> : <>
          {channel?.connected ? (
            <div className="grid gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 sm:grid-cols-3 dark:bg-emerald-950/25 dark:border-emerald-900/50">
              <Metric label="Número conectado" value={channel.integration.displayPhoneNumber || channel.number || "—"} />
              <Metric label="Nome da empresa" value={channel.integration.verifiedName || "Em validação pela Meta"} />
              <Metric label="Situação" value={channel.integration.qualityRating || "Atendimento ativo"} />
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5 dark:bg-emerald-950/25 dark:border-emerald-900/50">
              <p className="text-base font-black text-slate-950 dark:text-slate-100">Seu WhatsApp Business App permanece ativo.</p>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">O ChegowIA solicita o modo de coexistência da Meta: um único número para o app no celular, a IA e a equipe.</p>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                <li><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-black text-white">1</span>Clique em conectar.</li>
                <li><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-black text-white">2</span>Na Meta, escolha o número que já usa no WhatsApp Business App.</li>
                <li><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-black text-white">3</span>Volte para cá: a automação já fica ligada a este negócio.</li>
              </ol>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="p-5">
              <p className="text-sm font-black text-slate-900 dark:text-slate-100">{channel?.connected ? "Reconectar mantendo o WhatsApp Business" : "Conectar mantendo o WhatsApp Business"}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">A janela aberta é da própria Meta. Nenhuma senha ou credencial fica visível aqui, e o fluxo solicitado preserva o uso do número no app.</p>
            </div>
            <CardActions>
              <Button
                className="w-full sm:w-auto"
                type="button"
                isLoading={signupBusy}
                disabled={isLoadingSignupConfig || !signupConfig?.enabled}
                onClick={() => void startEmbeddedSignup()}
              >
                {channel?.connected ? "Reconectar e manter o app" : "Conectar e manter meu WhatsApp"}
              </Button>
            </CardActions>
          </div>

          {!isLoadingSignupConfig && !signupConfig?.enabled && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {signupConfig?.reason || "A conexão automática ainda não foi ativada pela plataforma."}
            </p>
          )}

          {channel?.connected && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-slate-900 dark:text-slate-100">Atendimento com IA e equipe</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Na primeira mensagem, a pessoa escolhe quem vai atender. Ao pedir uma pessoa, a IA para naquela conversa.</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={form.automationEnabled} onChange={(event) => setForm((current) => ({ ...current, automationEnabled: event.target.checked }))} />
                    Atendente virtual ativo
                  </label>
                </div>
                <div className="mt-4">
                  <FormField label="Mensagem de boas-vindas (opcional)">
                    <Textarea rows={3} value={form.welcomeMessage} placeholder="Olá! Você está falando com {empresa}. Como prefere continuar?" onChange={(event) => setForm((current) => ({ ...current, welcomeMessage: event.target.value }))} />
                  </FormField>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Use <code>{"{empresa}"}</code> para inserir o nome da sua empresa.</p>
                </div>
              </div>
              <CardActions>
                <Button className="w-full sm:w-auto" isLoading={saveAutomation.isPending} onClick={() => saveAutomation.mutate()}>Salvar atendimento</Button>
                <Link href="/painel/atendimento" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 sm:w-auto dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Abrir central de atendimento</Link>
              </CardActions>
            </div>
          )}

          <details className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <summary className="cursor-pointer text-sm font-black text-slate-800 dark:text-slate-200">Opções avançadas de suporte</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Você não precisa usar esta área. Abra somente se nossa equipe orientar uma conexão técnica manual.</p>
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              Atenção: a conexão manual não solicita coexistência e pode tirar o número do WhatsApp Business App. Para manter o app ativo, use o botão de conexão segura acima.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <FormField label="Identificador do número na Meta">
                <Input placeholder="Ex.: 123456789012345" value={form.phoneNumberId} onChange={(event) => setForm((current) => ({ ...current, phoneNumberId: event.target.value }))} />
              </FormField>
              <FormField label="Identificador da conta WhatsApp Business">
                <Input placeholder="Ex.: 123456789012345" value={form.businessAccountId} onChange={(event) => setForm((current) => ({ ...current, businessAccountId: event.target.value }))} />
              </FormField>
              <div className="lg:col-span-2">
                <FormField label="Credencial temporária da Meta">
                  <Input type="password" autoComplete="new-password" placeholder="Cole apenas se o suporte orientar" value={form.accessToken} onChange={(event) => setForm((current) => ({ ...current, accessToken: event.target.value }))} />
                </FormField>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Nesta conexão técnica, o ID da conta é necessário para assinar os webhooks e fazer as mensagens aparecerem na Central de atendimento.</p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={manualMigrationAcknowledged}
                onChange={(event) => setManualMigrationAcknowledged(event.target.checked)}
              />
              <span>Entendo que esta opção é técnica, não preserva o WhatsApp Business App e só deve ser usada com orientação do suporte.</span>
            </label>
            <CardActions className="-mx-4 mt-4 !px-4">
              <Button className="w-full sm:w-auto" variant="outline" isLoading={connectManually.isPending} disabled={!readyForManualConnection || !manualMigrationAcknowledged} onClick={() => connectManually.mutate()}>
                Conectar manualmente
              </Button>
            </CardActions>
            <div className="pt-5">
              <p className="text-sm font-black text-slate-900 dark:text-slate-100">Número usado nos links do site</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Normalmente ele é preenchido automaticamente pela conexão acima.</p>
              <div className="mt-3">
                <Input placeholder="5511999999999" value={form.fallbackNumber} onChange={(event) => setForm((current) => ({ ...current, fallbackNumber: event.target.value }))} />
              </div>
            </div>
            <CardActions className="-mx-4 -mb-4 mt-4 !px-4">
              <Button className="w-full sm:w-auto" variant="outline" isLoading={saveFallbackNumber.isPending} disabled={!form.fallbackNumber.trim()} onClick={() => saveFallbackNumber.mutate()}>Salvar número</Button>
            </CardActions>
          </details>
        </>}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{label}</p><p className="mt-1 truncate text-sm font-black text-slate-900 dark:text-slate-100">{value}</p></div>;
}

function isMetaOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

function parseMetaMessage(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function loadFacebookSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (typeof window === "undefined") return Promise.reject(new Error("SDK da Meta indisponível fora do navegador."));
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: false, version });
    return Promise.resolve(window.FB);
  }
  if (facebookSdkPromise) return facebookSdkPromise;

  facebookSdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const initialize = () => {
      if (!window.FB) {
        reject(new Error("SDK da Meta não carregou."));
        return;
      }
      window.FB.init({ appId, cookie: true, xfbml: false, version });
      resolve(window.FB);
    };
    const existing = document.getElementById(META_SDK_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", initialize, { once: true });
      existing.addEventListener("error", () => reject(new Error("SDK da Meta indisponível.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = META_SDK_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.addEventListener("load", initialize, { once: true });
    script.addEventListener("error", () => reject(new Error("SDK da Meta indisponível.")), { once: true });
    document.head.appendChild(script);
  });
  return facebookSdkPromise;
}
