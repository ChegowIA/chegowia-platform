"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { formatCurrency, formatDateTime } from "@/lib/format";

export default function ResellerDashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["reseller-dashboard"], queryFn: async () => (await api.get("/resellers/me/dashboard")).data as any });
  if (isLoading) return <p className="text-slate-500 dark:text-slate-400">Preparando sua central comercial...</p>;
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[30px] bg-slate-950 p-7 text-white shadow-2xl">
        <div className="absolute -right-10 -top-16 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand-300">Programa de parceiros</p>
          <h1 className="mt-3 text-3xl font-black">Sua operação comercial, em movimento.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">30% de comissão recorrente sobre a mensalidade dos clientes vinculados a você, após o teste e o crédito efetivo no Asaas.</p>
          <div className="mt-6 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.07] px-4 py-3">
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Seu código exclusivo</p><p className="text-xl font-black tracking-[.12em] text-brand-300">{data?.profile?.code}</p></div>
            <button onClick={()=>navigator.clipboard.writeText(data?.profile?.code)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-950">Copiar</button>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Disponível para saque" value={formatCurrency(data?.balances?.available ?? 0)} tone="emerald" />
        <Metric label="Em compensação" value={formatCurrency(data?.balances?.pendingSettlement ?? 0)} tone="brand" />
        <Metric label="Total recebido" value={formatCurrency(data?.balances?.paid ?? 0)} tone="violet" />
        <Metric label="Clientes ativos" value={data?.activeSubscriptions ?? 0} tone="amber" />
      </div>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-wide text-brand-700 dark:text-brand-300">Extrato</p><h2 className="mt-1 text-xl font-black">Comissões recentes</h2></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">30% recorrente</span></div>
        <div className="mt-5 space-y-2">
          {data?.commissions?.map((item:any)=><div key={item.id} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60"><div className="min-w-0"><p className="truncate text-sm font-black">{item.subscription?.company?.name}</p><p className="text-xs text-slate-400">{item.subscription?.plan?.name} · mensalidade-base {formatCurrency(Number(item.commissionBase??item.grossAmount))} · {formatDateTime(item.createdAt)}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{item.lifecycle?.detail}</p></div><div className="shrink-0 text-right"><p className={`font-black ${Number(item.commissionAmount)<0?"text-rose-700 dark:text-rose-300":"text-emerald-700 dark:text-emerald-300"}`}>{Number(item.commissionAmount)<0?"":"+ "}{formatCurrency(Number(item.commissionAmount))}</p><p className="text-[10px] font-bold uppercase text-slate-400">{item.lifecycle?.label??item.status}</p></div></div>)}
          {!data?.commissions?.length&&<p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">A comissão aparece quando o cliente conclui o teste, paga a mensalidade e o Asaas confirma o crédito.</p>}
        </div>
      </section>
    </div>
  );
}

function Metric({label,value,tone}:{label:string;value:string|number;tone:string}) {
  // O gradiente terminava sempre em `to-white`: no tema escuro o cartão
  // ficava branco com o texto claro por cima. A parada final acompanha o tema.
  const colors:any={
    emerald:"from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-900 text-emerald-700 dark:text-emerald-300",
    brand:"from-orange-50 to-white dark:from-brand-950/40 dark:to-slate-900 text-brand-700 dark:text-brand-300",
    violet:"from-violet-50 to-white dark:from-violet-950/40 dark:to-slate-900 text-violet-700 dark:text-violet-300",
    amber:"from-amber-50 to-white dark:from-amber-950/40 dark:to-slate-900 text-amber-700 dark:text-amber-300",
  };
  return <div className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br ${colors[tone]} p-4 shadow-sm`}><p className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>
}
