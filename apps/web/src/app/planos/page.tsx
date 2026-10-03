"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApplicationStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatCurrency, formatRateCurrency } from "@/lib/format";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AccountAccessLink } from "@/components/layout/public-access-actions";

const EMPTY_FORM = {
  resellerCode: "",
  responsibleName: "",
  email: "",
  phone: "",
  document: "",
  companyName: "",
  tradeName: "",
  city: "",
  state: "",
  zipCode: "",
  businessType: "",
  operationDetails: "",
  password: "",
  confirmPassword: "",
  acceptTerms: false,
  acceptPrivacy: false,
  acceptAutomatedAnalysis: false,
};

const PENDING_CHECKOUT_KEY = "chegowia:pending-checkout";

type SoftwarePlan = {
  id: string;
  name: string;
  description?: string | null;
  monthlyPrice: number | string;
  features: string[];
};

type PublicRate = {
  metric: string;
  provider: string;
  label: string;
  description: string;
  unitSize: number;
  pricePerUnit: number;
};

type PublicPricing = {
  billingCycle: "mensal";
  variableUsageBilling: string;
  trial?: { days: number; description: string };
  rates: PublicRate[];
};

type PendingCheckout = {
  url: string;
  companyName: string;
  email: string;
  createdAt: string;
};

export default function PlansPage() {
  const [selectedPlan, setSelectedPlan] = useState<SoftwarePlan | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [showContractBreakdown, setShowContractBreakdown] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [result, setResult] = useState<any>(null);
  const [codeInfo, setCodeInfo] = useState<any>(null);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PENDING_CHECKOUT_KEY);
      if (saved) setPendingCheckout(JSON.parse(saved));
    } catch {
      localStorage.removeItem(PENDING_CHECKOUT_KEY);
    }
  }, []);

  const {
    data: plans = [],
    isPending: plansLoading,
    isError: plansError,
    refetch: refetchPlans,
  } = useQuery({
    queryKey: ["software-plans"],
    queryFn: async () => (await api.get<SoftwarePlan[]>("/billing/plans")).data,
  });
  const { data: pricing, isLoading: pricingLoading } = useQuery({
    queryKey: ["public-pricing"],
    queryFn: async () => (await api.get<PublicPricing>("/billing/pricing")).data,
    staleTime: 60_000,
  });

  const validateCode = useMutation({
    mutationFn: async () => (await api.get(`/billing/referral/${form.resellerCode}`)).data,
    onSuccess: setCodeInfo,
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (!selectedPlan) throw new Error("Selecione um plano para continuar.");
      return (await api.post("/billing/applications", { ...form, planId: selectedPlan.id })).data;
    },
    onSuccess: (application) => {
      setResult(application);
      if (application.trialStarted) {
        localStorage.removeItem(PENDING_CHECKOUT_KEY);
        setPendingCheckout(null);
      }
      if (!application.checkoutUrl) return;
      const pending = {
        url: application.checkoutUrl,
        companyName: form.tradeName || form.companyName,
        email: form.email,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pending));
      setPendingCheckout(pending);
      window.location.href = application.checkoutUrl;
    },
  });

  const startContract = (plan: SoftwarePlan) => {
    setSelectedPlan(plan);
    setResult(null);
    setShowContractBreakdown(false);
  };
  const discardPending = () => {
    localStorage.removeItem(PENDING_CHECKOUT_KEY);
    setPendingCheckout(null);
  };
  const featuredPlan = selectedPlan ?? plans[0];

  return (
    <main className="min-h-screen bg-[#f6f7f9] dark:bg-[#080d18]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/software"><BrandLogo adaptive className="h-10 w-44" /></Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <AccountAccessLink />
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-14 text-center sm:py-16">
        <p className="text-xs font-black uppercase tracking-[.18em] text-brand-700 dark:text-brand-300">Plano simples, operação completa</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl dark:text-slate-100">Comece com tudo que precisa.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-600 dark:text-slate-400">Um único plano para a operação inteira, com 7 dias para testar tudo. Você acompanha separadamente qualquer uso de IA e WhatsApp.</p>

        {pendingCheckout && (
          <aside className="relative mx-auto mt-8 max-w-xl overflow-hidden rounded-[28px] bg-slate-950 p-5 text-left text-white shadow-2xl">
            <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-brand-500/30 blur-2xl" />
            <div className="relative flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-500 text-xl shadow-lg shadow-brand-500/30">↗</div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black uppercase tracking-[.18em] text-brand-300">Pagamento pendente</p>
                <h2 className="mt-1 truncate text-lg font-black">{pendingCheckout.companyName || "Sua assinatura ChegowIA"}</h2>
                <p className="mt-1 text-sm text-slate-300">Sua página segura do Stripe continua disponível. Você pode retomar de onde parou.</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button className="flex-1" onClick={() => { window.location.href = pendingCheckout.url; }}>Continuar pagamento</Button>
                  <Button variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={discardPending}>Fazer novo cadastro</Button>
                </div>
              </div>
            </div>
          </aside>
        )}

        <div className="mx-auto mt-10 max-w-xl">
          {plansLoading && (
            <article className="overflow-hidden rounded-[34px] border-2 border-slate-200 bg-white p-7 text-left shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="h-5 w-36 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
              <div className="mt-5 h-8 w-2/3 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
              <div className="mt-4 h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
              <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
              <div className="mt-8 h-14 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
            </article>
          )}

          {!plansLoading && (plansError || plans.length === 0) && (
            <article className="rounded-[30px] border border-amber-200 bg-amber-50 p-7 text-left shadow-lg dark:border-amber-900/60 dark:bg-amber-950/20">
              <p className="text-xs font-black uppercase tracking-[.16em] text-amber-800 dark:text-amber-300">Contratação temporariamente indisponível</p>
              <h2 className="mt-3 text-xl font-black text-slate-950 dark:text-slate-100">Estamos preparando o plano para você.</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Atualize a página em instantes. Se o problema continuar, tente carregar os planos novamente.</p>
              <Button className="mt-5" variant="outline" onClick={() => void refetchPlans()}>Tentar novamente</Button>
            </article>
          )}

          {plans.map((plan) => (
            <article key={plan.id} className="relative overflow-hidden rounded-[34px] border-2 border-brand-300 bg-white p-7 text-left shadow-2xl dark:bg-slate-900">
              <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-brand-100/70 blur-3xl dark:bg-brand-500/10" />
              <div className="relative">
                <div className="flex flex-wrap gap-2"><span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-black text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">MAIS COMPLETO</span><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">7 DIAS GRÁTIS</span></div>
                <h2 className="mt-5 text-2xl font-black text-slate-950 dark:text-slate-100">{plan.name}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{plan.description}</p>
                <p className="mt-6 text-4xl font-black text-slate-950 dark:text-slate-100">{formatCurrency(Number(plan.monthlyPrice))}<span className="text-sm font-bold text-slate-400">/mês</span></p>
                <p className="mt-2 text-[11px] font-medium leading-5 text-slate-500 dark:text-slate-400">Durante o teste você não paga nada. IA e WhatsApp são medidos normalmente e entram na primeira fatura só se você decidir continuar.</p>

                <button
                  type="button"
                  onClick={() => setPricingOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-black text-brand-700 transition hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
                >
                  Ver detalhes da cobrança <span aria-hidden>→</span>
                </button>

                <div className="my-7 space-y-3">
                  {plan.features.map((feature) => <p key={feature} className="text-sm font-semibold text-slate-700 dark:text-slate-300">✓ {feature}</p>)}
                </div>
                <Button className="w-full" size="lg" onClick={() => startContract(plan)}>Começar teste grátis de 7 dias</Button>
                <p className="mt-3 text-center text-xs text-slate-400">Sem cartão agora · código de parceiro dá 15% de desconto por 3 meses após a ativação</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <Modal open={pricingOpen} onClose={() => setPricingOpen(false)} title="Entenda sua cobrança">
        <PricingBreakdown plan={featuredPlan} pricing={pricing} loading={pricingLoading} />
      </Modal>

      <Modal open={Boolean(selectedPlan)} onClose={() => setSelectedPlan(null)} title={`Teste grátis do ${selectedPlan?.name ?? ""}`}>
        {result && !result.checkoutUrl ? (
          <div className={`rounded-2xl p-5 ${result.trialStarted ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"}`}>
            <p className="font-black">{result.trialStarted ? "Seu teste gratuito começou" : result.status === ApplicationStatus.REVISAO_HUMANA ? "Cadastro em revisão" : "Cadastro aprovado"}</p>
            <p className="mt-2 text-sm">{result.feedback || result.message}</p>
            {result.trialStarted && <><p className="mt-3 text-sm leading-6">Confirme o e-mail informado para acessar a empresa. Até o fim do teste, todos os recursos ficam liberados; os usos de IA e WhatsApp aparecerão no painel como consumo coberto.</p><Link href="/acesso" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-brand-700">Ir para acessar minha conta</Link></>}
          </div>
        ) : (
          <div className="space-y-4">
            {selectedPlan && (
              <ContractSummary
                plan={selectedPlan}
                open={showContractBreakdown}
                onToggle={() => setShowContractBreakdown((current) => !current)}
                pricing={pricing}
                loading={pricingLoading}
              />
            )}
            <div className="rounded-2xl bg-brand-50 p-3 dark:bg-brand-950/30">
              <FormField label="Código de revendedor (opcional)">
                <div className="flex gap-2">
                  <Input value={form.resellerCode} onChange={(event) => { setForm({ ...form, resellerCode: event.target.value }); setCodeInfo(null); }} />
                  <Button type="button" size="sm" variant="outline" onClick={() => validateCode.mutate()}>Validar</Button>
                </div>
              </FormField>
              {codeInfo && <p className={`mt-2 text-xs font-bold ${codeInfo.valid ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-400"}`}>{codeInfo.valid ? `Código de ${codeInfo.resellerName}: 15% por 3 meses` : "Código inválido"}</p>}
            </div>

            <Field label="Responsável" field="responsibleName" form={form} setForm={setForm} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="E-mail" field="email" form={form} setForm={setForm} type="email" />
              <Field label="Telefone" field="phone" form={form} setForm={setForm} mask="phone" />
            </div>
            <Field label="CNPJ" field="document" form={form} setForm={setForm} mask="document" />
            <Field label="Razão social" field="companyName" form={form} setForm={setForm} />
            <Field label="Nome fantasia" field="tradeName" form={form} setForm={setForm} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cidade" field="city" form={form} setForm={setForm} />
              <FormField label="UF"><BrazilStateSelect value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></FormField>
            </div>
            <Field label="CEP operacional" field="zipCode" form={form} setForm={setForm} mask="cep" />
            <Field label="Ramo de atividade" field="businessType" form={form} setForm={setForm} />
            <FormField label="Conte como funciona sua operação"><Textarea value={form.operationDetails} minLength={80} onChange={(event) => setForm({ ...form, operationDetails: event.target.value })} /></FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Senha do administrador" field="password" form={form} setForm={setForm} type="password" />
              <Field label="Confirmar senha" field="confirmPassword" form={form} setForm={setForm} type="password" />
            </div>
            <p className="-mt-2 text-xs text-slate-400">Mínimo de 8 caracteres, com maiúscula, minúscula e símbolo.</p>
            {form.confirmPassword && form.password !== form.confirmPassword && <p className="text-xs font-bold text-rose-600 dark:text-rose-400">As senhas não coincidem.</p>}
            <ConsentBox form={form} setForm={setForm} />
            {apply.error && <p className="text-sm text-rose-600 dark:text-rose-400">{apiErrorMessage(apply.error)}</p>}
            <Button
              className="w-full"
              disabled={!form.confirmPassword || form.password !== form.confirmPassword || form.zipCode.replace(/\D/g, "").length !== 8 || !form.acceptTerms || !form.acceptPrivacy || !form.acceptAutomatedAnalysis}
              isLoading={apply.isPending}
              onClick={() => apply.mutate()}
            >
              Criar empresa e iniciar teste grátis
            </Button>
            <p className="text-center text-[11px] leading-5 text-slate-400">Não pedimos pagamento agora. Ao fim dos 7 dias, o acesso é pausado e você escolhe se quer ativar o plano pagando a fatura, que traz a mensalidade mais o consumo de IA e WhatsApp que você usou. Se não ativar, nada é cobrado.</p>
          </div>
        )}
      </Modal>
    </main>
  );
}

function ContractSummary({ plan, open, onToggle, pricing, loading }: {
  plan: SoftwarePlan;
  open: boolean;
  onToggle: () => void;
  pricing?: PublicPricing;
  loading: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-accent-50 dark:border-brand-900/70 dark:from-brand-950/35 dark:via-slate-900 dark:to-accent-950/20">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-brand-700 dark:text-brand-300">Começo sem pagamento</p>
          <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200"><span className="text-lg font-black">7 dias grátis</span> para testar a operação completa</p>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Depois, você decide ativar por {formatCurrency(Number(plan.monthlyPrice))}/mês + uso novo de IA e WhatsApp.</p>
        </div>
        <button type="button" onClick={onToggle} aria-expanded={open} className="shrink-0 rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-800 transition hover:border-brand-400 hover:bg-brand-50 dark:border-brand-800 dark:bg-slate-900 dark:text-brand-200 dark:hover:bg-brand-950/50">
          {open ? "Ocultar detalhes" : "Ver detalhes"}
        </button>
      </div>
      {open && <div className="border-t border-brand-100 bg-white/70 p-4 dark:border-brand-900/50 dark:bg-slate-950/20"><PricingBreakdown plan={plan} pricing={pricing} loading={loading} compact /></div>}
    </section>
  );
}

function PricingBreakdown({ plan, pricing, loading, compact = false }: {
  plan?: SoftwarePlan;
  pricing?: PublicPricing;
  loading: boolean;
  compact?: boolean;
}) {
  const rates = pricing?.rates ?? [];
  const aiRates = rates.filter((rate) => rate.metric.startsWith("IA_"));
  const whatsappRates = rates.filter((rate) => rate.metric.startsWith("WHATSAPP_"));
  const basePrice = Number(plan?.monthlyPrice ?? 159.9);
  const trialDays = pricing?.trial?.days ?? 7;

  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      {!compact && (
        <div>
          <p className="text-sm font-black text-slate-950 dark:text-slate-100">Uma cobrança que você consegue prever</p>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Mostramos a mensalidade separada do uso variável. Assim, você sabe exatamente de onde vem cada valor — e o que fica coberto durante o teste.</p>
        </div>
      )}

      <div className="rounded-2xl bg-slate-950 p-4 text-white shadow-lg">
        <p className="text-[10px] font-black uppercase tracking-[.16em] text-brand-300">Depois do teste</p>
        <p className="mt-2 text-base font-black leading-6">{formatCurrency(basePrice)} mensal + IA utilizada + mensagens WhatsApp cobradas</p>
        <p className="mt-2 text-xs leading-5 text-slate-300">Se não houver consumo adicional no período, a fatura fica em {formatCurrency(basePrice)}.</p>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-200">
        <p className="font-black">{trialDays} dias de teste, sem cobrança</p>
        <p className="mt-1">Você pode usar recursos, IA e WhatsApp no período de teste, e cada evento aparece medido no painel com a tarifa vigente. Ao fim do prazo, o acesso é pausado até você optar por ativar o plano. Ativando, a primeira fatura soma a mensalidade e o consumo de IA e WhatsApp do período — em uma cobrança só. Se você não ativar, esse consumo não é cobrado.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <InfoCard title="Quando a IA entra" text="Cada conversa mede tokens de entrada, trechos reaproveitados em cache e respostas geradas. O uso é da empresa, não de cada funcionário." />
        <InfoCard title="Quando o WhatsApp entra" text="Cada mensagem recebe a categoria devolvida pela Meta. O sistema aplica somente a tarifa vigente daquela categoria e registra o detalhe na sua empresa." />
      </div>

      {loading ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">Carregando as tarifas vigentes…</p> : (
        <div className="space-y-4">
          <RateGroup title="Inteligência artificial" eyebrow="Tarifas por volume de tokens" rates={aiRates} />
          <RateGroup title="WhatsApp" eyebrow="Tarifas por mensagem classificada" rates={whatsappRates} />
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
        <p className="font-black text-slate-800 dark:text-slate-100">Como a cobrança é protegida</p>
        <p className="mt-1">Cada evento guarda a tarifa vigente no momento em que aconteceu. Alterações futuras não mudam um consumo já registrado. Apenas o uso posterior à ativação é consolidado na próxima fatura; o que ocorrer no teste fica marcado como coberto.</p>
      </div>
    </div>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm font-black text-slate-900 dark:text-slate-100">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{text}</p></div>;
}

function RateGroup({ title, eyebrow, rates }: { title: string; eyebrow: string; rates: PublicRate[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
      <div className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
        <p className="text-sm font-black text-slate-900 dark:text-slate-100">{title}</p>
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{eyebrow}</p>
      </div>
      {rates.length ? rates.map((rate) => (
        <div key={rate.metric} className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{rate.label}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{rate.description}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">Tarifa vigente · {rate.provider}</p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-sm font-black text-slate-950 dark:text-slate-100">{formatRateCurrency(rate.pricePerUnit)}</p>
            <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">{rateUnitLabel(rate)}</p>
          </div>
        </div>
      )) : <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">Nenhuma tarifa ativa nesta categoria.</p>}
    </section>
  );
}

function rateUnitLabel(rate: PublicRate) {
  if (!rate.metric.startsWith("IA_")) return "por mensagem";
  if (rate.unitSize === 1_000_000) return "por 1 milhão de tokens";
  return `por ${new Intl.NumberFormat("pt-BR").format(rate.unitSize)} tokens`;
}

function Field({ label, field, form, setForm, type = "text", mask }: {
  label: string;
  field: keyof typeof EMPTY_FORM;
  form: typeof EMPTY_FORM;
  setForm: (next: typeof EMPTY_FORM) => void;
  type?: string;
  mask?: "phone" | "document" | "cep";
}) {
  const value = String(form[field]);
  return (
    <FormField label={label}>
      {mask ? <MaskedInput mask={mask} value={value} onChange={(event) => setForm({ ...form, [field]: event.target.value })} /> : <Input type={type} value={value} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />}
    </FormField>
  );
}

function ConsentBox({ form, setForm }: { form: typeof EMPTY_FORM; setForm: (next: typeof EMPTY_FORM) => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
      <Consent checked={form.acceptTerms} onChange={(value) => setForm({ ...form, acceptTerms: value })}>Li e aceito os <Link className="font-bold text-brand-700 underline dark:text-brand-300" href="/termos" target="_blank">Termos de Uso</Link>.</Consent>
      <Consent checked={form.acceptPrivacy} onChange={(value) => setForm({ ...form, acceptPrivacy: value })}>Li e aceito a <Link className="font-bold text-brand-700 underline dark:text-brand-300" href="/privacidade" target="_blank">Política de Privacidade</Link>.</Consent>
      <Consent checked={form.acceptAutomatedAnalysis} onChange={(value) => setForm({ ...form, acceptAutomatedAnalysis: value })}>Autorizo a análise automatizada dos dados da empresa, com revisão humana disponível.</Consent>
    </div>
  );
}

function Consent({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-orange-600" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
