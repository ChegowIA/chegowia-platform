"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LeadStatus, Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { connectSocket } from "@/lib/socket-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export default function LeadsPage() {
  const qc=useQueryClient();
  const user=useAuthStore((state)=>state.user);
  const isSupportView=Boolean(user?.actorRole===Role.SUPER_ADMIN&&user.role===Role.REVENDEDOR&&user.impersonation?.supportAccess&&user.impersonation.kind==="RESELLER");
  const {data:leads=[]}=useQuery({queryKey:["reseller-leads"],queryFn:async()=>(await api.get<any[]>("/resellers/me/leads")).data,refetchInterval:15000});
  const claim=useMutation({mutationFn:(id:string)=>api.post(`/resellers/me/leads/${id}/claim`),onSuccess:()=>qc.invalidateQueries({queryKey:["reseller-leads"]})});
  useEffect(()=>{if(isSupportView)return;const socket=connectSocket();const refresh=()=>qc.invalidateQueries({queryKey:["reseller-leads"]});socket.on("lead.available",refresh);socket.on("lead.claimed",refresh);return()=>{socket.off("lead.available",refresh);socket.off("lead.claimed",refresh)}},[isSupportView,qc]);
  const available=leads.filter((x:any)=>x.status===LeadStatus.DISPONIVEL);
  const mine=leads.filter((x:any)=>x.status!==LeadStatus.DISPONIVEL);
  return <div className="space-y-6">
    <section className="rounded-[30px] bg-slate-950 p-7 text-white"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[.16em] text-emerald-300"><span className={`h-2 w-2 rounded-full ${isSupportView?"bg-violet-400":"animate-pulse bg-emerald-400"}`}/>{isSupportView?"Suporte somente leitura":"Distribuição ao vivo"}</div><h1 className="mt-3 text-3xl font-black">{isSupportView?"Carteira do revendedor":"Novas oportunidades"}</h1><p className="mt-2 max-w-xl text-sm text-slate-300">{isSupportView?"Esta visão mostra somente os leads já vinculados ao parceiro. A fila coletiva e as ações comerciais ficam bloqueadas.":"O primeiro parceiro que assumir fica responsável pelo contato. Só assuma quando puder atender rapidamente."}</p></section>
    {claim.error&&<p className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(claim.error)}</p>}
    {!isSupportView&&<div><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">Disponíveis agora</h2><span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-black text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">{available.length}</span></div><div className="grid gap-4 lg:grid-cols-2">{available.map((lead:any)=><Lead key={lead.id} lead={lead} action={<Button size="sm" isLoading={claim.isPending} onClick={()=>claim.mutate(lead.id)}>Assumir este lead</Button>}/>)}{!available.length&&<p className="col-span-full rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">Nenhum lead livre neste momento. A tela atualiza automaticamente.</p>}</div></div>}
    <div><h2 className="mb-3 text-xl font-black">Sob sua responsabilidade</h2><div className="grid gap-4 lg:grid-cols-2">{mine.map((lead:any)=><Lead key={lead.id} lead={lead} action={isSupportView?null:<a href={`https://wa.me/${lead.phone.replace(/\D/g,"")}`} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white">Falar no WhatsApp</a>}/>)}</div></div>
  </div>;
}
function Lead({lead,action}:{lead:any;action:React.ReactNode}){return <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:bg-slate-900 dark:border-slate-800"><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black">{lead.name}</p><p className="text-xs text-slate-400">{lead.companyName||"Empresa não informada"} · {formatDateTime(lead.createdAt)}</p></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{lead.status}</span></div><p className="my-4 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">{lead.message}</p><div className="flex items-center justify-between gap-3"><div className="text-xs text-slate-500 dark:text-slate-400"><p>{lead.city}{lead.state?`/${lead.state}`:""}</p><p>{lead.phone}</p></div>{action}</div></article>}
