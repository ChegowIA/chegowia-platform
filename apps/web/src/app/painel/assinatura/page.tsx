"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SubscriptionStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatCurrency, formatUsageCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";

/** `SEM_ASSINATURA` é um sentinela da API, não um valor do enum persistido. */
type BillingStatus = SubscriptionStatus | "SEM_ASSINATURA";

type UsageItem = {
  metric: string;
  label: string;
  quantity: number;
  providerAmount: number;
  billableAmount: number;
  trialQuantity: number;
  trialProviderAmount: number;
  trialCoveredAmount: number;
  unpriced: number;
};

type UsageSource = {
  source: "IA" | "WHATSAPP";
  label: string;
  quantity: number;
  providerAmount: number;
  billableAmount: number;
  trialQuantity: number;
  trialProviderAmount: number;
  trialCoveredAmount: number;
};

type UsageSummary = {
  periodStart: string;
  periodEnd: string;
  baseMonthlyPrice: number;
  providerTotal: number;
  variableTotal: number;
  variableTotalCharged: number;
  estimatedTotal: number;
  trialCovered: { entries: number; providerTotal: number; nominalAmount: number };
  unpricedEvents: number;
  items: UsageItem[];
  sources: UsageSource[];
  previous?: Omit<UsageSummary, "previous">;
};

type Trial = {
  days: number;
  startedAt?: string | null;
  endsAt?: string | null;
  current: boolean;
  active: boolean;
  expired: boolean;
  daysRemaining: number;
};

type Invoice = {
  id: string;
  value: number;
  dueDate: string | null;
  status: string;
  paid: boolean;
  url: string | null;
};

type BillingData = {
  status: BillingStatus;
  provider?: "ASAAS" | "STRIPE" | null;
  manageable?: boolean;
  accessRestricted?: boolean;
  activationAvailable?: boolean;
  currentPeriodEnd?: string | null;
  plan?: { name: string; monthlyPrice: number; currency: string };
  trial?: Trial | null;
  referral?: { code: string; resellerName: string; discountEndsAt?: string | null } | null;
  usage?: UsageSummary;
};

export default function SubscriptionPage() {
  const queryClient = useQueryClient();
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["company-billing-status"],
    queryFn: async () => (await api.get("/billing/company/status")).data as BillingData,
    refetchInterval: (query) => query.state.data?.status === SubscriptionStatus.EM_TESTE ? 60_000 : false,
  });
  const { data: invoiceData } = useQuery({
    queryKey: ["company-invoices"],
    queryFn: async () => (await api.get("/billing/company/invoices")).data as { provider: string | null; invoices: Invoice[] },
    enabled: Boolean(data?.manageable),
  });
  const portal = useMutation({
    mutationFn: async () => (await api.post("/billing/company/portal")).data as { url: string },
    onSuccess: (result) => { window.location.href = result.url; },
  });
  const activate = useMutation({
    mutationFn: async () => (await api.post("/billing/company/checkout")).data as { url: string },
    onSuccess: (result) => { window.location.href = result.url; },
  });
  const cancel = useMutation({
    mutationFn: async () => (await api.post("/billing/company/cancel")).data as { endsAt?: string | null; scheduled?: boolean },
    onSuccess: () => {
      setConfirmandoCancelamento(false);
      queryClient.invalidateQueries({ queryKey: ["company-billing-status"] });
      queryClient.invalidateQueries({ queryKey: ["company-invoices"] });
    },
  });
  const viaAsaas = data?.provider === "ASAAS";

  const statusMeta: Record<BillingStatus, { label: string; tone: string; detail: string }> = {
    [SubscriptionStatus.ATIVA]: {
      label: "Assinatura ativa",
      tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
      detail: "A operação está liberada e a cobrança recorrente está em dia.",
    },
    [SubscriptionStatus.EM_TESTE]: {
      label: data?.trial?.expired ? "Teste encerrado" : "Teste gratuito ativo",
      tone: data?.trial?.expired
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
      detail: data?.trial?.expired
        ? "Os 7 dias terminaram e a operação foi pausada. Ative a assinatura para liberar tudo novamente."
        : "Você está usando a operação completa sem cobrança durante o período de teste.",
    },
    [SubscriptionStatus.INADIMPLENTE]: {
      label: "Pagamento pendente",
      tone: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
      detail: "Regularize a forma de pagamento no portal para reativar todos os recursos.",
    },
    [SubscriptionStatus.CANCELADA]: {
      label: "Assinatura cancelada",
      tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
      detail: "A cobrança recorrente foi encerrada. Fale com o suporte para uma nova contratação.",
    },
    [SubscriptionStatus.PENDENTE]: {
      label: "Ativação pendente",
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
      detail: "A confirmação do pagamento ainda está sendo processada.",
    },
    SEM_ASSINATURA: {
      label: "Sem assinatura",
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
      detail: "Não encontramos uma assinatura vinculada a esta empresa.",
    },
  };

  const meta = statusMeta[data?.status ?? SubscriptionStatus.PENDENTE];
  const usage = data?.usage;
  const trial = data?.trial;
  const currentTrial = Boolean(trial?.current);
  const trialExpired = Boolean(currentTrial && (trial?.expired || data?.activationAvailable));
  const base = usage?.baseMonthlyPrice ?? Number(data?.plan?.monthlyPrice ?? 159.9);
  const estimated = usage?.estimatedTotal ?? base;
  const ia = usage?.sources?.find((source) => source.source === "IA");
  const whatsapp = usage?.sources?.find((source) => source.source === "WHATSAPP");
  const previous = usage?.previous;
  const covered = usage?.trialCovered;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="relative overflow-hidden rounded-[30px] bg-slate-950 p-7 text-white shadow-xl">
        <div className="absolute -right-14 -top-16 h-52 w-52 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand-300">Conta da empresa</p>
          <h1 className="mt-2 text-3xl font-black">Assinatura e cobrança</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Plano base, IA e WhatsApp sempre separados. Durante o teste, o consumo aparece com transparência, mas é integralmente coberto pela ChegowIA.</p>
        </div>
      </header>

      {error && <p className="rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(error)}</p>}

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">Consultando assinatura…</p> : <>
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${meta.tone}`}>{meta.label}</span>
              <h2 className="mt-4 text-2xl font-black">{data?.plan?.name ?? "ChegowIA"}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{meta.detail}</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{currentTrial ? "Cobrança do teste" : "Você deve até agora"}</p>
              <p className="mt-1 text-3xl font-black">{formatCurrency(estimated)}</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{currentTrial ? "Nenhum consumo do teste será faturado" : "Mensalidade + consumo do mês"}</p>
              {!currentTrial && previous ? <div className="mt-2 flex sm:justify-end"><Delta current={estimated} previous={previous.estimatedTotal} suffix="vs. mês anterior" /></div> : null}
            </div>
          </div>

          {currentTrial && trial && <TrialNotice trial={trial} planPrice={Number(data?.plan?.monthlyPrice ?? 159.9)} />}
          {data?.currentPeriodEnd && <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">Período atual até {formatDate(data.currentPeriodEnd)}.</p>}
          {data?.referral && <div className="mt-5 rounded-2xl bg-brand-50 p-4 text-sm text-brand-900 dark:bg-brand-950/30 dark:text-brand-200"><strong>Código {data.referral.code}</strong> vinculado por {data.referral.resellerName}.{data.referral.discountEndsAt && ` Desconto inicial até ${formatDate(data.referral.discountEndsAt)}.`}</div>}

          {trialExpired ? <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900/60 dark:bg-brand-950/25">
            <p className="text-sm font-black text-brand-950 dark:text-brand-100">Sua empresa está pausada até a ativação.</p>
            <p className="mt-1 text-xs leading-5 text-brand-800 dark:text-brand-200">A fatura de ativação começa uma nova assinatura de {formatCurrency(Number(data?.plan?.monthlyPrice ?? 159.9))}/mês. IA e WhatsApp usados no teste não entram nela.</p>
            <Button className="mt-4 w-full sm:w-auto" isLoading={activate.isPending} onClick={() => activate.mutate()}>Gerar fatura e liberar tudo</Button>
            {activate.error && <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-400">{apiErrorMessage(activate.error)}</p>}
          </div> : data?.manageable ? <>
            <Button className="mt-6" isLoading={portal.isPending} onClick={() => portal.mutate()}>{viaAsaas ? "Abrir fatura em aberto" : "Abrir portal seguro do Stripe"}</Button>
            {viaAsaas && <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">A forma de pagamento é escolhida na própria fatura: Pix, boleto ou cartão, a cada mês.</p>}
            {portal.error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{apiErrorMessage(portal.error)}</p>}
          </> : null}
        </>}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[.14em] text-brand-700 dark:text-brand-300">Composição transparente</p>
            <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">{currentTrial ? "O que foi usado no teste" : "Como sua conta é formada"}</h2>
          </div>
          {usage && <p className="text-xs text-slate-500 dark:text-slate-400">De {formatDate(usage.periodStart)} até {formatDate(usage.periodEnd)}</p>}
        </div>

        {covered && (covered.entries > 0 || covered.nominalAmount > 0) ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100">
          <p className="font-black">{covered.entries} evento(s) de consumo coberto(s) pela ChegowIA</p>
          <p className="mt-1">Tarifa de referência: {formatUsageCurrency(covered.nominalAmount)} · custo real de fornecedores: {formatUsageCurrency(covered.providerTotal)}. Esses valores ficam no histórico, mas não são devidos por você.</p>
        </div> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Amount label="Mensalidade" value={base} hint={currentTrial ? "R$ 0,00 durante o teste" : "Plano contratado"} tone="bg-slate-50 text-slate-900 dark:bg-slate-800/60 dark:text-slate-100" />
          <Amount
            label="Inteligência artificial"
            value={ia?.billableAmount ?? 0}
            hint={currentTrial && ia?.trialQuantity ? `${compactNumber(ia.trialQuantity)} tokens cobertos` : ia?.quantity ? `${compactNumber(ia.quantity)} tokens` : "Sem consumo"}
            tone="bg-brand-50 text-brand-900 dark:bg-brand-950/30 dark:text-brand-200"
            preciso
            delta={!currentTrial && previous ? { current: ia?.billableAmount ?? 0, previous: previous.sources?.find((s) => s.source === "IA")?.billableAmount ?? 0 } : undefined}
          />
          <Amount
            label="WhatsApp"
            value={whatsapp?.billableAmount ?? 0}
            hint={currentTrial && whatsapp?.trialQuantity ? `${formatCount(whatsapp.trialQuantity, "mensagem", "mensagens")} cobertas` : whatsapp?.quantity ? `${formatCount(whatsapp.quantity, "mensagem", "mensagens")}` : "Sem consumo"}
            tone="bg-accent-50 text-accent-900 dark:bg-accent-950/30 dark:text-accent-200"
            preciso
            delta={!currentTrial && previous ? { current: whatsapp?.billableAmount ?? 0, previous: previous.sources?.find((s) => s.source === "WHATSAPP")?.billableAmount ?? 0 } : undefined}
          />
          <Amount
            label={currentTrial ? "Total a pagar" : "Total estimado"}
            value={estimated}
            hint={currentTrial ? "R$ 0,00: consumo coberto" : (usage?.variableTotal ?? 0) > 0 && (usage?.variableTotalCharged ?? 0) === 0 ? "Consumo abaixo de R$ 0,01 acumula" : "O que entra na fatura"}
            tone="bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          />
        </div>

        {usage?.unpricedEvents ? <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Há {usage.unpricedEvents} evento(s) sem uma taxa ativa. Eles estão registrados, mas não entram em adicional até a precificação ser configurada.</div> : null}

        <h3 className="mt-7 text-sm font-black text-slate-800 dark:text-slate-200">Detalhamento do consumo</h3>
        <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {usage?.items?.length ? usage.items.map((item) => {
            const coveredByTrial = item.trialCoveredAmount > 0 || item.trialQuantity > 0;
            return <div key={item.metric} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatQuantity(item.metric, item.quantity)}{item.providerAmount > 0 && <> · custo do provedor {formatUsageCurrency(item.providerAmount)}</>}</p>
                {coveredByTrial && <p className="mt-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Teste gratuito cobriu {formatUsageCurrency(item.trialCoveredAmount)} dessa métrica.</p>}
              </div>
              {coveredByTrial && item.billableAmount === 0 ? <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Coberto</span> : <p className="shrink-0 text-sm font-black text-slate-900 dark:text-slate-100">{formatUsageCurrency(item.billableAmount)}</p>}
            </div>;
          }) : <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Ainda não houve consumo variável neste período.</div>}
        </div>

        {!currentTrial && previous && (previous.variableTotal > 0 || (usage?.variableTotal ?? 0) > 0) ? <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"><span className="font-bold">Mês anterior:</span><span>{formatUsageCurrency(previous.variableTotal)} de consumo variável</span><Delta current={usage?.variableTotal ?? 0} previous={previous.variableTotal} /></div> : null}

        <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">{currentTrial ? "As tarifas e custos continuam registrados para você acompanhar o uso real. Eles foram classificados como cobertos no teste e são excluídos de qualquer fatura posterior." : covered?.entries ? "O histórico separa o que foi coberto no teste do consumo que começou depois da ativação. Só o uso posterior pode compor uma fatura." : (viaAsaas ? "O custo variável é somado à próxima cobrança mensal, na mesma fatura da mensalidade. Cada evento guarda a tarifa vigente no momento em que aconteceu." : "O custo variável é consolidado por métrica e enviado como item da próxima fatura Stripe. Cada evento guarda a tarifa vigente no momento em que aconteceu.")}</p>
      </section>

      {data?.manageable ? <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs font-black uppercase tracking-[.14em] text-brand-700 dark:text-brand-300">Faturas</p>
        <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">Cobranças e forma de pagamento</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{viaAsaas ? "Cada cobrança abre uma fatura onde você escolhe entre Pix, boleto ou cartão. O consumo variável do mês entra somada à mensalidade, na mesma cobrança." : "As faturas ficam disponíveis no portal seguro do Stripe."}</p>

        <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {invoiceData?.invoices?.length ? invoiceData.invoices.map((invoice) => (
            <div key={invoice.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatCurrency(invoice.value)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{invoice.dueDate ? `Vencimento ${formatDate(invoice.dueDate)}` : "Sem vencimento"} · {invoiceStatusLabel(invoice.status)}</p>
              </div>
              {invoice.paid
                ? <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Paga</span>
                : invoice.url ? <a className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900" href={invoice.url} target="_blank" rel="noopener noreferrer">Pagar</a> : null}
            </div>
          )) : <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Nenhuma cobrança emitida até agora.</div>}
        </div>

        {data.status !== SubscriptionStatus.CANCELADA ? <div className="mt-6 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm font-black text-slate-900 dark:text-slate-100">Cancelar assinatura</p>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Nenhuma cobrança nova é emitida depois do cancelamento. O acesso continua até o fim do período já pago — cancelar não devolve o valor do mês corrente.</p>
          {confirmandoCancelamento
            ? <div className="mt-3 flex flex-wrap gap-3">
                <Button variant="secondary" isLoading={cancel.isPending} onClick={() => cancel.mutate()}>Confirmar cancelamento</Button>
                <Button variant="secondary" onClick={() => setConfirmandoCancelamento(false)}>Manter assinatura</Button>
              </div>
            : <Button className="mt-3" variant="secondary" onClick={() => setConfirmandoCancelamento(true)}>Quero cancelar</Button>}
          {cancel.error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{apiErrorMessage(cancel.error)}</p>}
          {cancel.isSuccess && <p className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">Assinatura cancelada.{cancel.data?.endsAt ? ` O acesso segue até ${formatDate(cancel.data.endsAt)}.` : ""}</p>}
        </div> : null}
      </section> : null}
    </div>
  );
}

function invoiceStatusLabel(status: string) {
  const mapa: Record<string, string> = {
    PENDING: "Aguardando pagamento",
    RECEIVED: "Paga",
    CONFIRMED: "Paga",
    RECEIVED_IN_CASH: "Paga",
    OVERDUE: "Vencida",
    REFUNDED: "Estornada",
    AWAITING_RISK_ANALYSIS: "Em análise",
    paid: "Paga",
    open: "Aguardando pagamento",
    void: "Cancelada",
    uncollectible: "Não recebida",
  };
  return mapa[status] ?? status;
}

function TrialNotice({ trial, planPrice }: { trial: Trial; planPrice: number }) {
  const endsAt = trial.endsAt ? formatDateTime(trial.endsAt) : "o fim do período";
  if (trial.expired) {
    return <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100"><p className="font-black">O teste de {trial.days} dias terminou em {endsAt}.</p><p className="mt-1">O acesso foi pausado. Para voltar a usar a empresa, gere a fatura de ativação abaixo. Nada que você consumiu no teste será adicionado a ela.</p></div>;
  }
  return <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-100"><p className="font-black">Você está no teste gratuito de {trial.days} dias.</p><p className="mt-1">Restam {trial.daysRemaining} {trial.daysRemaining === 1 ? "dia" : "dias"}; o período termina em {endsAt}. Use tudo normalmente: IA e WhatsApp são medidos, mas os custos deste teste são pagos pela ChegowIA.</p><p className="mt-1 text-xs font-semibold">Ao final, sua operação será pausada. Você só paga se quiser ativar o plano por {formatCurrency(planPrice)}/mês.</p></div>;
}

function Amount({ label, value, hint, tone, delta, preciso }: {
  label: string;
  value: number;
  hint?: string;
  tone: string;
  delta?: { current: number; previous: number };
  preciso?: boolean;
}) {
  return <div className={`rounded-2xl p-4 ${tone}`}><p className="text-xs font-bold uppercase tracking-wide opacity-65">{label}</p><p className="mt-2 text-xl font-black">{preciso ? formatUsageCurrency(value) : formatCurrency(value)}</p>{hint && <p className="mt-1 text-[11px] font-semibold opacity-60">{hint}</p>}{delta && <div className="mt-2"><Delta current={delta.current} previous={delta.previous} /></div>}</div>;
}

function Delta({ current, previous, suffix }: { current: number; previous: number; suffix?: string }) {
  if (previous <= 0) return null;
  const percent = ((current - previous) / previous) * 100;
  if (!Number.isFinite(percent) || Math.abs(percent) < 1) return null;
  const up = percent > 0;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black ${up ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>{up ? "▲" : "▼"} {Math.abs(percent).toFixed(0)}%{suffix ? ` ${suffix}` : ""}</span>;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCount(value: number, singular: string, plural: string) {
  const rounded = Math.round(value);
  return `${new Intl.NumberFormat("pt-BR").format(rounded)} ${rounded === 1 ? singular : plural}`;
}

function formatQuantity(metric: string, quantity: number) {
  if (metric.startsWith("IA_")) return `${compactNumber(quantity)} tokens`;
  return formatCount(quantity, "mensagem", "mensagens");
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
}
