"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { SubscriptionStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatCurrency, formatUsageCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";

/**
 * A API devolve SEM_ASSINATURA quando a empresa não tem assinatura vinculada
 * (billing.service.ts). Não é um membro de SubscriptionStatus no banco, então
 * fica como sentinela local em vez de poluir o enum espelhado do schema.
 */
type BillingStatus = SubscriptionStatus | "SEM_ASSINATURA";

type UsageItem = { metric: string; label: string; quantity: number; providerAmount: number; billableAmount: number; unpriced: number };
type UsageSource = { source: "IA" | "WHATSAPP"; label: string; quantity: number; providerAmount: number; billableAmount: number };

type UsageSummary = {
  periodStart: string;
  periodEnd: string;
  baseMonthlyPrice: number;
  providerTotal: number;
  /** Precisão de milionésimo: consumo de IA custa frações de centavo. */
  variableTotal: number;
  /** O que efetivamente entra na fatura, em centavos. O resíduo acumula. */
  variableTotalCharged: number;
  estimatedTotal: number;
  unpricedEvents: number;
  items: UsageItem[];
  sources: UsageSource[];
  previous?: Omit<UsageSummary, "previous">;
};

export default function SubscriptionPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["company-billing-status"],
    queryFn: async () => (await api.get("/billing/company/status")).data as { plan?: { name: string; monthlyPrice: number; currency: string }; usage?: UsageSummary; [key: string]: any },
  });
  const portal = useMutation({
    mutationFn: async () => (await api.post("/billing/company/portal")).data as { url: string },
    onSuccess: (result) => { window.location.href = result.url; },
  });
  const statusMeta: Record<BillingStatus, { label: string; tone: string; detail: string }> = {
    [SubscriptionStatus.ATIVA]: { label: "Assinatura ativa", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", detail: "A operação está liberada e a cobrança recorrente está em dia." },
    [SubscriptionStatus.INADIMPLENTE]: { label: "Pagamento pendente", tone: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300", detail: "Regularize a forma de pagamento no portal para reativar todos os recursos." },
    [SubscriptionStatus.CANCELADA]: { label: "Assinatura cancelada", tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300", detail: "A cobrança recorrente foi encerrada. Fale com o suporte para uma nova contratação." },
    [SubscriptionStatus.PENDENTE]: { label: "Ativação pendente", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300", detail: "A confirmação do pagamento ainda está sendo processada." },
    SEM_ASSINATURA: { label: "Sem assinatura", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300", detail: "Não encontramos uma assinatura vinculada a esta empresa." },
  };
  const meta = statusMeta[data?.status as BillingStatus] ?? statusMeta[SubscriptionStatus.PENDENTE];
  const usage = data?.usage;
  const base = usage?.baseMonthlyPrice ?? Number(data?.plan?.monthlyPrice ?? 159.9);
  const estimated = usage?.estimatedTotal ?? base;
  const ia = usage?.sources?.find((source) => source.source === "IA");
  const whatsapp = usage?.sources?.find((source) => source.source === "WHATSAPP");
  const previous = usage?.previous;

  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="relative overflow-hidden rounded-[30px] bg-slate-950 p-7 text-white shadow-xl"><div className="relative"><p className="text-xs font-black uppercase tracking-[.18em] text-brand-300">Conta da empresa</p><h1 className="mt-2 text-3xl font-black">Assinatura e cobrança</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Sua mensalidade combina o plano base com o uso efetivo de IA e WhatsApp. Cada consumo fica detalhado antes da próxima fatura.</p></div></header>
    {error && <p className="rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(error)}</p>}

    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:bg-slate-900 dark:border-slate-800">{isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">Consultando assinatura…</p> : <><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${meta.tone}`}>{meta.label}</span><h2 className="mt-4 text-2xl font-black">{data?.plan?.name ?? "ChegowIA"}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{meta.detail}</p></div><div className="text-left sm:text-right"><p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Você deve até agora</p><p className="mt-1 text-3xl font-black">{formatCurrency(estimated)}</p><p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Mensalidade + consumo do mês</p>{previous ? <div className="mt-2 flex sm:justify-end"><Delta current={estimated} previous={previous.estimatedTotal} suffix="vs. mês anterior" /></div> : null}</div></div>{data?.currentPeriodEnd && <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">Período atual até {new Date(data.currentPeriodEnd).toLocaleDateString("pt-BR")}.</p>}{data?.referral && <div className="mt-5 rounded-2xl bg-brand-50 p-4 text-sm text-brand-900 dark:bg-brand-950/30 dark:text-brand-200"><strong>Código {data.referral.code}</strong> vinculado por {data.referral.resellerName}.{data.referral.discountEndsAt && ` Desconto inicial até ${new Date(data.referral.discountEndsAt).toLocaleDateString("pt-BR")}.`}</div>}<Button className="mt-6" disabled={!data?.manageable} isLoading={portal.isPending} onClick={() => portal.mutate()}>Abrir portal seguro do Stripe</Button>{portal.error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{apiErrorMessage(portal.error)}</p>}</>}</section>

    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[.14em] text-brand-700 dark:text-brand-300">Composição transparente</p>
          <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">Como sua conta é formada</h2>
        </div>
        {usage && <p className="text-xs text-slate-500 dark:text-slate-400">De {new Date(usage.periodStart).toLocaleDateString("pt-BR")} até {new Date(usage.periodEnd).toLocaleDateString("pt-BR")}</p>}
      </div>

      {/* Mensalidade, IA e WhatsApp separados: as duas fontes têm unidades e
          ordens de grandeza diferentes, e somá-las esconde quem puxa a conta. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Amount label="Mensalidade" value={base} hint="Plano contratado" tone="bg-slate-50 text-slate-900 dark:bg-slate-800/60 dark:text-slate-100" />
        <Amount
          label="Inteligência artificial"
          value={ia?.billableAmount ?? 0}
          hint={ia?.quantity ? `${compactNumber(ia.quantity)} tokens` : "Sem consumo"}
          tone="bg-brand-50 text-brand-900 dark:bg-brand-950/30 dark:text-brand-200"
          preciso
          delta={previous ? { current: ia?.billableAmount ?? 0, previous: previous.sources?.find((s) => s.source === "IA")?.billableAmount ?? 0 } : undefined}
        />
        <Amount
          label="WhatsApp"
          value={whatsapp?.billableAmount ?? 0}
          hint={whatsapp?.quantity ? `${formatCount(whatsapp.quantity, "mensagem", "mensagens")}` : "Sem consumo"}
          tone="bg-accent-50 text-accent-900 dark:bg-accent-950/30 dark:text-accent-200"
          preciso
          delta={previous ? { current: whatsapp?.billableAmount ?? 0, previous: previous.sources?.find((s) => s.source === "WHATSAPP")?.billableAmount ?? 0 } : undefined}
        />
        <Amount
          label="Total estimado"
          value={estimated}
          hint={
            // O consumo só vira centavo quando passa de um. Dizer isso evita a
            // leitura de que o sistema "não contabilizou" o que aparece acima.
            (usage?.variableTotal ?? 0) > 0 && (usage?.variableTotalCharged ?? 0) === 0
              ? "Consumo abaixo de R$ 0,01 acumula para a próxima fatura"
              : "O que entra na fatura"
          }
          tone="bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        />
      </div>

      {usage?.unpricedEvents ? (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Há {usage.unpricedEvents} evento(s) de uso sem uma taxa ativa na tabela da plataforma. Eles estão registrados, mas não entram no adicional até a precificação ser configurada.
        </div>
      ) : null}

      <h3 className="mt-7 text-sm font-black text-slate-800 dark:text-slate-200">Detalhamento do consumo</h3>
      <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
        {usage?.items?.length ? usage.items.map((item) => (
          <div key={item.metric} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatQuantity(item.metric, item.quantity)}
                {item.providerAmount > 0 && <> · custo do provedor {formatUsageCurrency(item.providerAmount)}</>}
              </p>
            </div>
            <p className="shrink-0 text-sm font-black text-slate-900 dark:text-slate-100">{formatUsageCurrency(item.billableAmount)}</p>
          </div>
        )) : (
          <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Ainda não houve consumo variável neste período.</div>
        )}
      </div>

      {previous && (previous.variableTotal > 0 || (usage?.variableTotal ?? 0) > 0) ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <span className="font-bold">Mês anterior:</span>
          <span>{formatUsageCurrency(previous.variableTotal)} de consumo variável</span>
          <Delta current={usage?.variableTotal ?? 0} previous={previous.variableTotal} />
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
        O custo variável é consolidado por métrica e enviado como item da próxima fatura Stripe. As taxas são definidas pela plataforma conforme o custo vigente do provedor e a margem configurada — o custo do provedor aparece acima para você conferir a formação de cada valor.
      </p>
    </section>
  </div>;
}

function Amount({ label, value, hint, tone, delta, preciso }: {
  label: string;
  value: number;
  hint?: string;
  tone: string;
  delta?: { current: number; previous: number };
  /**
   * Consumo pode custar frações de centavo e precisa das casas extras;
   * mensalidade e total são valores de fatura e ficam em duas casas.
   */
  preciso?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-4 ${tone}`}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-65">{label}</p>
      <p className="mt-2 text-xl font-black">{preciso ? formatUsageCurrency(value) : formatCurrency(value)}</p>
      {hint && <p className="mt-1 text-[11px] font-semibold opacity-60">{hint}</p>}
      {delta && <div className="mt-2"><Delta current={delta.current} previous={delta.previous} /></div>}
    </div>
  );
}

/** Variação percentual contra o mês anterior. Some quando não há base de comparação. */
function Delta({ current, previous, suffix }: { current: number; previous: number; suffix?: string }) {
  if (previous <= 0) return null;
  const percent = ((current - previous) / previous) * 100;
  if (!Number.isFinite(percent) || Math.abs(percent) < 1) return null;
  const up = percent > 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black ${
      up
        ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
    }`}>
      {up ? "▲" : "▼"} {Math.abs(percent).toFixed(0)}%{suffix ? ` ${suffix}` : ""}
    </span>
  );
}

/** Tokens chegam na casa dos milhões: o número cru não comunica nada. */
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
