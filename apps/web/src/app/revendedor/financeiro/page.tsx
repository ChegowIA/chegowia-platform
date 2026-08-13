"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

type ContaForm = { postalCode: string; address: string; addressNumber: string; province: string; complement: string; incomeValue: string; birthDate: string };
const CONTA_VAZIA: ContaForm = { postalCode: "", address: "", addressNumber: "", province: "", complement: "", incomeValue: "", birthDate: "" };

export default function FinanceiroPage() {
  const queryClient=useQueryClient();
  const [form,setForm]=useState<ContaForm>(CONTA_VAZIA);
  const [abrirForm,setAbrirForm]=useState(false);
  const {data}=useQuery({queryKey:["reseller-dashboard"],queryFn:async()=>(await api.get("/resellers/me/dashboard")).data as any});
  const {data:connectStatus,error:statusError,isFetching:checkingStatus}=useQuery({queryKey:["reseller-connect-status"],queryFn:async()=>(await api.get("/billing/reseller/connect/status")).data as any,refetchInterval:(query)=>query.state.data?.status==="EM_ANALISE"?15_000:false});
  const asaas=connectStatus?.provider==="ASAAS";
  const connect=useMutation({
    mutationFn:async(payload?:Record<string,unknown>)=> (await api.post("/billing/reseller/connect",payload??{})).data as {url:string;destination?:string},
    onSuccess:(x)=>{
      // No Asaas a conta nasce pronta pela API: não há para onde redirecionar,
      // só atualizar o status. No Stripe o cadastro continua no site deles.
      if(asaas){setAbrirForm(false);setForm(CONTA_VAZIA);queryClient.invalidateQueries({queryKey:["reseller-connect-status"]});return}
      window.location.href=x.url;
    },
  });
  const payout=useMutation({mutationFn:async()=> (await api.post("/billing/reseller/payout")).data,onSuccess:()=>queryClient.invalidateQueries({queryKey:["reseller-dashboard"]})});
  useEffect(()=>{if(new URLSearchParams(window.location.search).has("stripe")){queryClient.invalidateQueries({queryKey:["reseller-connect-status"]});queryClient.invalidateQueries({queryKey:["reseller-dashboard"]});window.history.replaceState(null,"",window.location.pathname)}},[queryClient]);
  const statusCopy:Record<string,{title:string;detail:string;tone:string}>={NAO_CONFIGURADO:{title:"Integração indisponível",detail:"A conta de recebimento ainda não foi configurada pelo ChegowIA.",tone:"bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/60 dark:text-rose-300"},NAO_INICIADO:{title:"Cadastro ainda não iniciado",detail:asaas?"Preencha seus dados para abrir a conta que recebe as comissões.":"Configure os dados de recebimento para solicitar seus repasses.",tone:"bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-300"},INCOMPLETO:{title:"Cadastro incompleto",detail:"Existem dados obrigatórios pendentes no Stripe. Continue o cadastro para liberar os repasses.",tone:"bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-300"},EM_ANALISE:{title:"Dados em análise",detail:"O Stripe recebeu seus dados e está verificando a conta. Atualizaremos este status automaticamente.",tone:"bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:border-sky-900/60 dark:text-sky-300"},ATIVO:{title:"Conta pronta para receber",detail:asaas?"Sua conta Asaas está ativa e habilitada para receber as comissões.":"Sua conta está verificada e habilitada para repasses.",tone:"bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/60 dark:text-emerald-300"}};
  const current=statusCopy[connectStatus?.status]??statusCopy.NAO_INICIADO;
  const set=(campo:keyof ContaForm)=>(event:React.ChangeEvent<HTMLInputElement>)=>setForm((atual)=>({...atual,[campo]:event.target.value}));
  const enviarConta=(event:React.FormEvent)=>{
    event.preventDefault();
    connect.mutate({
      postalCode:form.postalCode.replace(/\D/g,""),
      address:form.address.trim(),
      addressNumber:form.addressNumber.trim(),
      province:form.province.trim(),
      ...(form.complement.trim()?{complement:form.complement.trim()}:{}),
      incomeValue:Number(form.incomeValue.replace(/\D/g,"")),
      ...(form.birthDate?{birthDate:form.birthDate}:{}),
    });
  };
  const mostrarForm=asaas&&connectStatus?.requiresForm&&abrirForm;
  return <div className="space-y-6">
    <div><p className="text-xs font-black uppercase tracking-wide text-brand-700 dark:text-brand-300">Financeiro</p><h1 className="mt-1 text-3xl font-black">Saldo e recebimentos</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Valores só entram no saldo após pagamento confirmado e processado pelo webhook.</p></div>
    <div className="grid gap-4 md:grid-cols-2"><div className="rounded-[28px] bg-emerald-600 p-6 text-white shadow-xl"><p className="text-xs font-bold uppercase text-emerald-100">Disponível</p><p className="mt-3 text-4xl font-black">{formatCurrency(data?.balances?.available??0)}</p><p className="mt-3 text-xs text-emerald-100">Comissões ainda não repassadas</p></div><div className="rounded-[28px] bg-slate-950 p-6 text-white"><p className="text-xs font-bold uppercase text-slate-400">Já recebido</p><p className="mt-3 text-4xl font-black">{formatCurrency(data?.balances?.paid??0)}</p></div></div>
    <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:bg-slate-900 dark:border-slate-800">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><h2 className="text-xl font-black">Conta de recebimento</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">{asaas?"Abrimos uma conta Asaas no seu nome para receber as comissões. Os dados de identificação ficam sob custódia do Asaas, instituição de pagamento autorizada — o ChegowIA não guarda dados bancários.":"Complete o onboarding seguro do Stripe Connect. Dados bancários e verificações ficam sob custódia do Stripe, não do ChegowIA."}</p></div>{checkingStatus&&<span className="text-xs font-bold text-slate-400">Verificando…</span>}</div>
      <div className={`mt-5 rounded-2xl border p-4 ${current.tone}`}><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/70 font-black dark:bg-slate-900/70">{connectStatus?.ready?"✓":"!"}</span><div><p className="font-black">{current.title}</p><p className="mt-0.5 text-xs leading-5 opacity-80">{current.detail}</p></div></div>{connectStatus?.requirementsDue?.length>0&&<p className="mt-3 text-xs font-bold">{connectStatus.requirementsDue.length} pendência(s) precisam ser concluídas no ambiente seguro do Stripe.</p>}</div>
      {mostrarForm
        ? <form onSubmit={enviarConta} className="mt-5 grid gap-4 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-800">
            <FormField label="CEP"><Input value={form.postalCode} onChange={set("postalCode")} inputMode="numeric" maxLength={9} placeholder="74000000" required /></FormField>
            <FormField label="Bairro"><Input value={form.province} onChange={set("province")} placeholder="Setor Central" required /></FormField>
            <FormField label="Endereço"><Input value={form.address} onChange={set("address")} placeholder="Rua 15" required /></FormField>
            <FormField label="Número"><Input value={form.addressNumber} onChange={set("addressNumber")} placeholder="120" required /></FormField>
            <FormField label="Complemento (opcional)"><Input value={form.complement} onChange={set("complement")} placeholder="Sala 3" /></FormField>
            <FormField label="Faturamento mensal estimado (R$)"><Input value={form.incomeValue} onChange={set("incomeValue")} inputMode="numeric" placeholder="5000" required /></FormField>
            <FormField label="Data de nascimento (pessoa física)"><Input type="date" value={form.birthDate} onChange={set("birthDate")} /></FormField>
            <div className="flex items-end gap-3 sm:col-span-2"><Button type="submit" isLoading={connect.isPending}>Abrir conta de recebimento</Button><Button type="button" variant="secondary" onClick={()=>setAbrirForm(false)}>Cancelar</Button></div>
          </form>
        : <div className="mt-5 flex flex-wrap gap-3">
            <Button
              isLoading={connect.isPending}
              disabled={connectStatus?.configured===false}
              onClick={()=>{if(asaas&&connectStatus?.requiresForm){setAbrirForm(true);return}connect.mutate(undefined)}}
            >
              {connectStatus?.status==="NAO_INICIADO"?"Configurar recebimentos":connectStatus?.ready?(asaas?"Acessar minha conta Asaas":"Revisar dados no Stripe"):"Continuar cadastro no Stripe"}
            </Button>
            {connectStatus?.ready&&<Button variant="secondary" isLoading={payout.isPending} onClick={()=>payout.mutate()}>Solicitar repasse</Button>}
          </div>}
      {(connect.error||payout.error||statusError)&&<p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(connect.error||payout.error||statusError)}</p>}
      <p className="mt-3 text-xs text-slate-400">Repasse mínimo: R$ 10,00. A comissão fica disponível 7 dias após o pagamento do cliente, prazo que cobre estorno e contestação.</p>
    </section>
  </div>;
}
