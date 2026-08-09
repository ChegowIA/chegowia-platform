"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

type UsageRate = {
  id: string;
  metric: string;
  provider: string;
  label: string;
  unitSize: number | string;
  providerUnitCost: number | string;
  markupPercent: number | string;
  isActive: boolean;
};

export default function AdminPlansPage() {
  const queryClient = useQueryClient();
  const { data: plans = [] } = useQuery({
    queryKey: ["software-plans"],
    queryFn: async () => (await api.get<any[]>("/billing/plans")).data,
  });
  const { data: rates = [], isLoading: loadingRates } = useQuery({
    queryKey: ["usage-rates"],
    queryFn: async () =>
      (await api.get<UsageRate[]>("/usage/admin/rates")).data,
  });
  const plan = plans[0];
  const [price, setPrice] = useState("");
  const [stripePrice, setStripePrice] = useState("");
  useEffect(() => {
    if (plan) {
      setPrice(String(Number(plan.monthlyPrice)));
      setStripePrice(plan.stripePriceId || "");
    }
  }, [plan]);
  const savePlan = useMutation({
    mutationFn: () =>
      api.patch(`/billing/admin/plans/${plan.id}`, {
        monthlyPrice: Number(price),
        stripePriceId: stripePrice,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["software-plans"] }),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] bg-slate-950 p-7 text-white">
        <p className="text-xs font-black uppercase tracking-[.16em] text-brand-300">
          Stripe Billing
        </p>
        <h1 className="mt-3 text-3xl font-black">Planos e cobrança variável</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          O plano base atual é {plan ? formatCurrency(Number(plan.monthlyPrice)) : "carregado pela configuração"}/mês.
          IA e WhatsApp são lançados pelo consumo real registrado, usando as
          taxas abaixo no momento de cada evento.
        </p>
      </section>
      {plan && (
        <div className="grid gap-5 lg:grid-cols-[1fr_.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:bg-slate-900 dark:border-slate-800">
            <h2 className="text-xl font-black">{plan.name}</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {plan.description}
            </p>
            <div className="mt-6 space-y-4">
              <FormField label="Preço mensal base">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </FormField>
              <FormField label="Stripe Price ID recorrente">
                <Input
                  placeholder="price_..."
                  value={stripePrice}
                  onChange={(event) => setStripePrice(event.target.value)}
                />
              </FormField>
              {savePlan.error && (
                <p className="text-sm text-rose-600 dark:text-rose-400">
                  {apiErrorMessage(savePlan.error)}
                </p>
              )}
              <Button
                isLoading={savePlan.isPending}
                onClick={() => savePlan.mutate()}
              >
                Salvar plano base
              </Button>
            </div>
          </section>
          <aside className="rounded-3xl border border-amber-200 bg-amber-50 p-6 dark:bg-amber-950/30 dark:border-amber-900/60">
            <p className="text-xs font-black uppercase text-amber-700 dark:text-amber-300">
              Checklist Stripe
            </p>
            <div className="mt-4 space-y-3 text-sm text-amber-900 dark:text-amber-200">
              <p>
                1. Crie ou atualize o produto recorrente mensal para o mesmo
                valor exibido.
              </p>
              <p>
                2. Cole o identificador <b>price_...</b> acima.
              </p>
              <p>
                3. O sistema cria itens de fatura separados para o consumo
                variável.
              </p>
              <p>4. Faça uma compra teste antes de mudar as chaves live.</p>
            </div>
            <p className="mt-6 text-2xl font-black text-amber-950 dark:text-amber-200">
              {formatCurrency(Number(price || 0))}/mês
            </p>
          </aside>
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:bg-slate-900 dark:border-slate-800">
        <div>
          <p className="text-xs font-black uppercase tracking-[.14em] text-brand-700 dark:text-brand-300">
            Tabela de custos
          </p>
          <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
            Taxas de IA e WhatsApp
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            Informe o custo do provedor em reais por unidade e, se desejar, a
            margem da plataforma. A cobrança ao empresário é calculada como
            custo do provedor + margem; eventos antigos preservam a taxa usada
            naquele momento.
          </p>
        </div>
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {loadingRates && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Carregando tabela de custos...
            </p>
          )}
          {rates.map((rate) => (
            <RateEditor key={rate.metric} rate={rate} />
          ))}
          {!loadingRates && rates.length === 0 && (
            <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              A tabela ainda não foi inicializada. Execute o seed após aplicar a
              migração para criar as métricas padrão.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function RateEditor({ rate }: { rate: UsageRate }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    provider: rate.provider,
    label: rate.label,
    unitSize: String(Number(rate.unitSize)),
    providerUnitCost: String(Number(rate.providerUnitCost)),
    markupPercent: String(Number(rate.markupPercent)),
    isActive: rate.isActive,
  });
  useEffect(() => {
    setForm({
      provider: rate.provider,
      label: rate.label,
      unitSize: String(Number(rate.unitSize)),
      providerUnitCost: String(Number(rate.providerUnitCost)),
      markupPercent: String(Number(rate.markupPercent)),
      isActive: rate.isActive,
    });
  }, [rate]);
  const save = useMutation({
    mutationFn: () =>
      api.put("/usage/admin/rates", {
        metric: rate.metric,
        provider: form.provider,
        label: form.label,
        unitSize: Number(form.unitSize),
        providerUnitCost: Number(form.providerUnitCost),
        markupPercent: Number(form.markupPercent),
        isActive: form.isActive,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["usage-rates"] }),
  });
  return (
    <article className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900 dark:text-slate-100">
            {rate.label}
          </p>
          <p className="mt-1 text-[11px] font-mono text-slate-400">
            {rate.metric}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                isActive: event.target.checked,
              }))
            }
          />
          Ativa
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FormField label="Provedor">
          <Input
            value={form.provider}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                provider: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Unidade (ex.: 1000 tokens)">
          <Input
            type="number"
            min="0.000001"
            step="any"
            value={form.unitSize}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                unitSize: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Custo do provedor (R$)">
          <Input
            type="number"
            min="0"
            step="0.000001"
            value={form.providerUnitCost}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                providerUnitCost: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Margem (%)">
          <Input
            type="number"
            min="0"
            step="0.0001"
            value={form.markupPercent}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                markupPercent: event.target.value,
              }))
            }
          />
        </FormField>
      </div>
      <Button
        size="sm"
        className="mt-4"
        isLoading={save.isPending}
        onClick={() => save.mutate()}
      >
        Salvar taxa
      </Button>
      {save.error && (
        <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
          {apiErrorMessage(save.error)}
        </p>
      )}
    </article>
  );
}
