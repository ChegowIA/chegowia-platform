"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

type OperationalStatus = {
  healthy: boolean;
  counts: {
    failedStripeEvents: number;
    staleStripeEvents: number;
    failedPayouts: number;
    stuckPayouts: number;
    incompleteConnect: number;
    delinquentSubscriptions: number;
  };
  failedEvents: Array<{
    id: string;
    type: string;
    attempts: number;
    lastError?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  checkedAt: string;
};

export default function OperationalStatusPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["operational-status"],
    queryFn: async () => (await api.get<OperationalStatus>("/billing/admin/operational-status")).data,
    refetchInterval: 30_000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/billing/admin/stripe-events/${id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operational-status"] }),
  });
  const cards = [
    ["Webhooks com falha", data?.counts.failedStripeEvents ?? 0, "Eventos de pagamento que precisam de revisão"],
    ["Eventos atrasados", data?.counts.staleStripeEvents ?? 0, "Pendentes ou processando há mais de 10 minutos"],
    ["Repasses com falha", data?.counts.failedPayouts ?? 0, "Lotes preservados para nova análise"],
    ["Repasses em atenção", data?.counts.stuckPayouts ?? 0, "Em processamento há mais de 10 minutos"],
    ["Connect incompleto", data?.counts.incompleteConnect ?? 0, "Revendedores com cadastro bancário pendente"],
    ["Assinaturas em atraso", data?.counts.delinquentSubscriptions ?? 0, "Empresas com cobrança inadimplente"],
  ] as const;

  return <div className="space-y-6">
    <header className={`relative overflow-hidden rounded-[30px] p-7 text-white shadow-xl ${data?.healthy ? "bg-emerald-700" : "bg-slate-950"}`}>
      <p className="text-xs font-black uppercase tracking-[.18em] text-white/70">Monitoramento interno</p>
      <h1 className="mt-2 text-3xl font-black">{isLoading ? "Verificando a operação…" : data?.healthy ? "Fluxos financeiros saudáveis" : "Há itens que precisam de atenção"}</h1>
      <p className="mt-2 text-sm text-white/75">Stripe, repasses, assinaturas e cadastros Connect em uma visão operacional. Atualização automática a cada 30 segundos.</p>
    </header>
    {error && <p className="rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(error)}</p>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label,value,help])=><article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:bg-slate-900 dark:border-slate-800"><p className={`text-3xl font-black ${value ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{value}</p><h2 className="mt-3 text-sm font-black">{label}</h2><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{help}</p></article>)}</section>
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
      <div className="border-b border-slate-100 p-5 dark:border-slate-800"><h2 className="text-xl font-black">Eventos Stripe com falha</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">O payload financeiro não é exibido nesta tela. Ao reenfileirar, o mesmo ID idempotente é reutilizado.</p></div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">{data?.failedEvents.map((event)=><article key={event.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_2fr_auto] lg:items-center"><div><p className="font-black">{event.type}</p><p className="mt-1 break-all text-[11px] text-slate-400">{event.id}</p></div><div><p className="line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{event.lastError || "Falha sem descrição"}</p><p className="mt-1 text-xs text-slate-400">{event.attempts} tentativa(s) · {formatDateTime(event.updatedAt)}</p></div><Button size="sm" variant="outline" isLoading={retry.isPending} onClick={()=>retry.mutate(event.id)}>Reenfileirar</Button></article>)}{!isLoading&&!data?.failedEvents.length&&<div className="p-10 text-center"><p className="text-3xl">✓</p><p className="mt-2 font-black text-emerald-700 dark:text-emerald-300">Nenhum webhook com falha</p></div>}</div>
    </section>
    {retry.error&&<p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(retry.error)}</p>}
  </div>;
}
