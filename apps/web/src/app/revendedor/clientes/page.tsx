"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LeadStatus, Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";
import { Modal } from "@/components/ui/modal";

const EMPTY_SALE = { sourceLeadId: "", responsibleName: "", email: "", phone: "", document: "", companyName: "", tradeName: "", city: "", state: "", businessType: "", operationDetails: "", password: "", confirmPassword: "", acceptTerms: false, acceptPrivacy: false, acceptAutomatedAnalysis: false };
/** DISPONIVEL fica de fora de propósito: é o estágio pré-claim, exibido em /revendedor/leads. */
const LEAD_STAGES = [
  { key: LeadStatus.EM_ATENDIMENTO, label: "Em atendimento", dot: "bg-sky-500", surface: "bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300" },
  { key: LeadStatus.PROPOSTA, label: "Proposta enviada", dot: "bg-violet-500", surface: "bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300" },
  { key: LeadStatus.CONVERTIDO, label: "Clientes convertidos", dot: "bg-emerald-500", surface: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" },
  { key: LeadStatus.PERDIDO, label: "Não avançaram", dot: "bg-slate-400", surface: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
] as const;

export default function ClientesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isSupportView = Boolean(
    user?.actorRole === Role.SUPER_ADMIN
      && user.role === Role.REVENDEDOR
      && user.impersonation?.supportAccess
      && user.impersonation.kind === "RESELLER",
  );
  const [prospectOpen, setProspectOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [activeStage, setActiveStage] = useState<LeadStatus>(LeadStatus.EM_ATENDIMENTO);
  const [prospect, setProspect] = useState({ name: "", companyName: "", email: "", phone: "", notes: "" });
  const [sale, setSale] = useState<any>(EMPTY_SALE);
  const [result, setResult] = useState<any>(null);

  const { data: leads = [] } = useQuery({
    queryKey: ["reseller-leads"],
    queryFn: async () => (await api.get<any[]>("/resellers/me/leads")).data,
    refetchInterval: 20_000,
  });
  const { data: prospects = [] } = useQuery({
    queryKey: ["reseller-prospects"],
    queryFn: async () => (await api.get<any[]>("/resellers/me/prospects")).data,
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["software-plans"],
    queryFn: async () => (await api.get<any[]>("/billing/plans")).data,
  });

  const mine = leads.filter((lead: any) => lead.status !== LeadStatus.DISPONIVEL);
  const visibleLeads = mine.filter((lead: any) => lead.status === activeStage);

  const addProspect = useMutation({
    mutationFn: () => api.post("/resellers/me/prospects", prospect),
    onSuccess: () => {
      setProspectOpen(false);
      setProspect({ name: "", companyName: "", email: "", phone: "", notes: "" });
      queryClient.invalidateQueries({ queryKey: ["reseller-prospects"] });
    },
  });
  const moveLead = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/resellers/me/leads/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reseller-leads"] }),
  });
  const createLink = useMutation({
    mutationFn: async () => (await api.post("/billing/reseller/payment-links", { ...sale, planId: plans[0]?.id })).data,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["reseller-leads"] });
      if (sale.sourceLeadId) setActiveStage(LeadStatus.PROPOSTA);
    },
  });

  const openSale = (lead?: any) => {
    setResult(null);
    setSale(lead ? {
      ...EMPTY_SALE,
      sourceLeadId: lead.id,
      responsibleName: lead.name,
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      companyName: lead.companyName ?? "",
      tradeName: lead.companyName ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "",
      operationDetails: lead.message ?? "",
    } : EMPTY_SALE);
    setSaleOpen(true);
  };

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-[30px] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -right-10 -top-16 h-52 w-52 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-brand-300">Sua carteira comercial</p>
            <h1 className="mt-2 text-3xl font-black">Clientes e oportunidades</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Todo lead aceito entra aqui. Acompanhe o contato, inicie o teste gratuito e acompanhe a ativação quando o cliente decidir continuar.</p>
          </div>
          {isSupportView ? (
            <span className="rounded-full border border-violet-300/40 bg-violet-400/10 px-3 py-2 text-xs font-black text-violet-200">Visualização somente leitura</span>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setProspectOpen(true)}>+ Contato manual</Button>
              <Button onClick={() => openSale()}>Nova venda direta</Button>
            </div>
          )}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LEAD_STAGES.map((stage) => {
          const count = mine.filter((lead: any) => lead.status === stage.key).length;
          const selected = activeStage === stage.key;
          return (
            <button key={stage.key} onClick={() => setActiveStage(stage.key)} className={`rounded-2xl border p-4 text-left transition ${selected ? "border-slate-900 bg-white shadow-lg ring-2 ring-slate-900/5 dark:bg-slate-900" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900 dark:border-slate-800"}`}>
              <span className={`block h-2 w-10 rounded-full ${stage.dot}`} />
              <strong className="mt-4 block text-3xl font-black">{count}</strong>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{stage.label}</span>
            </button>
          );
        })}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black">{LEAD_STAGES.find((stage) => stage.key === activeStage)?.label}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Somente contatos assumidos pela sua conta.</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-400">{visibleLeads.length}</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {visibleLeads.map((lead: any) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              stage={LEAD_STAGES.find((stage) => stage.key === lead.status)!}
              loading={moveLead.isPending}
              readOnly={isSupportView}
              onProposal={() => openSale(lead)}
              onLost={() => moveLead.mutate({ id: lead.id, status: LeadStatus.PERDIDO })}
              onReopen={() => moveLead.mutate({ id: lead.id, status: LeadStatus.EM_ATENDIMENTO })}
            />
          ))}
          {!visibleLeads.length && <div className="col-span-full rounded-[28px] border border-dashed border-slate-300 bg-white p-10 text-center dark:bg-slate-900 dark:border-slate-700"><div className="text-3xl">◎</div><p className="mt-3 font-black text-slate-700 dark:text-slate-300">Nenhum contato nesta etapa</p><p className="mt-1 text-sm text-slate-400">Quando você aceitar uma oportunidade, ela aparecerá automaticamente em “Em atendimento”.</p></div>}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-black">Prospecções cadastradas por você</h2><p className="text-xs text-slate-500 dark:text-slate-400">Contatos adicionados manualmente, fora da distribuição ao vivo.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black dark:bg-slate-800">{prospects.length}</span></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{prospects.map((item: any) => <div key={item.id} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="flex justify-between gap-2"><p className="font-black">{item.name}</p><span className="text-[10px] font-black uppercase text-brand-700 dark:text-brand-300">{item.stage}</span></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.companyName || "Empresa não informada"}</p><p className="mt-3 text-xs text-slate-400">{item.phone || item.email || "Sem contato"}</p></div>)}{!prospects.length && <p className="col-span-full py-7 text-center text-sm text-slate-400">Nenhum contato manual cadastrado.</p>}</div>
      </section>

      {!isSupportView && (
        <>
          <Modal open={prospectOpen} onClose={() => setProspectOpen(false)} title="Novo possível cliente">
            <div className="space-y-4"><Field label="Nome" k="name" state={prospect} set={setProspect} /><Field label="Empresa" k="companyName" state={prospect} set={setProspect} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Telefone" k="phone" state={prospect} set={setProspect} mask="phone" /><Field label="E-mail" k="email" state={prospect} set={setProspect} type="email" /></div><FormField label="Anotações"><Textarea value={prospect.notes} onChange={(event) => setProspect({ ...prospect, notes: event.target.value })} /></FormField>{addProspect.error && <ErrorMessage error={addProspect.error} />}<Button className="w-full" isLoading={addProspect.isPending} onClick={() => addProspect.mutate()}>Salvar contato</Button></div>
          </Modal>

          <SaleModal open={saleOpen} close={() => setSaleOpen(false)} sale={sale} setSale={setSale} result={result} mutation={createLink} />
        </>
      )}
    </div>
  );
}

function LeadCard({ lead, stage, loading, readOnly, onProposal, onLost, onReopen }: any) {
  const whatsapp = lead.phone?.replace(/\D/g, "");
  return <article className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-slate-900 dark:border-slate-800"><div className={`h-1.5 ${stage.dot}`} /><div className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-lg font-black">{lead.name}</h3><p className="truncate text-xs text-slate-500 dark:text-slate-400">{lead.companyName || "Empresa não informada"} · {lead.city || "Cidade não informada"}{lead.state ? `/${lead.state}` : ""}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${stage.surface}`}>{stage.label}</span></div><p className="mt-4 line-clamp-3 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">{lead.message}</p><div className="mt-3 text-xs text-slate-400"><p>{lead.email}</p><p>{lead.phone}</p><p className="mt-1">Assumido em {formatDateTime(lead.claimedAt || lead.createdAt)}</p></div>{readOnly ? <p className="mt-4 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800 dark:bg-violet-950/30 dark:text-violet-200">Ações comerciais bloqueadas na visão de suporte.</p> : <div className="mt-4 flex flex-wrap gap-2">{whatsapp && <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 dark:text-slate-100">WhatsApp</a>}<a href={`mailto:${lead.email}`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 dark:border-slate-800 dark:text-slate-400">E-mail</a>{lead.status === LeadStatus.EM_ATENDIMENTO && <><Button size="sm" onClick={onProposal}>Iniciar teste</Button><Button size="sm" variant="ghost" disabled={loading} onClick={onLost}>Não avançou</Button></>}{lead.status === LeadStatus.PROPOSTA && <><Button size="sm" onClick={onProposal}>Ver teste enviado</Button><Button size="sm" variant="ghost" disabled={loading} onClick={onLost}>Marcar perdido</Button></>}{lead.status === LeadStatus.PERDIDO && <Button size="sm" variant="outline" disabled={loading} onClick={onReopen}>Retomar contato</Button>}</div>}</div></article>;
}

function SaleModal({ open, close, sale, setSale, result, mutation }: any) {
  return (
    <Modal open={open} onClose={close} title={sale.sourceLeadId ? "Iniciar teste para o lead" : "Cadastrar cliente e iniciar teste"}>
      {result ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            {result.trialStarted
              ? "Teste gratuito de 7 dias iniciado. O cliente recebeu a confirmação por e-mail para acessar a empresa; IA e WhatsApp são medidos e entram na primeira fatura apenas se ele decidir assinar."
              : result.message}
          </div>
          {result.checkoutUrl && <><Input readOnly value={result.checkoutUrl} /><div className="grid grid-cols-2 gap-2"><Button onClick={() => navigator.clipboard.writeText(result.checkoutUrl)}>Copiar link</Button><Button variant="outline" onClick={() => window.open(result.checkoutUrl, "_blank")}>Abrir Stripe</Button></div></>}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Responsável" k="responsibleName" state={sale} set={setSale} />
          <div className="grid gap-4 sm:grid-cols-2"><Field label="E-mail" k="email" state={sale} set={setSale} type="email" /><Field label="Telefone" k="phone" state={sale} set={setSale} mask="phone" /></div>
          <Field label="CNPJ" k="document" state={sale} set={setSale} mask="document" />
          <Field label="Razão social" k="companyName" state={sale} set={setSale} />
          <Field label="Nome fantasia" k="tradeName" state={sale} set={setSale} />
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Cidade" k="city" state={sale} set={setSale} /><FormField label="UF"><BrazilStateSelect value={sale.state} onChange={(event) => setSale({ ...sale, state: event.target.value })} /></FormField></div>
          <Field label="Tipo de negócio" k="businessType" state={sale} set={setSale} />
          <FormField label="Como funciona a operação"><Textarea minLength={80} value={sale.operationDetails} onChange={(event) => setSale({ ...sale, operationDetails: event.target.value })} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Senha inicial do administrador" k="password" state={sale} set={setSale} type="password" /><Field label="Confirmar senha" k="confirmPassword" state={sale} set={setSale} type="password" /></div>
          <p className="-mt-2 text-xs text-slate-400">Mínimo de 8 caracteres, com maiúscula, minúscula e símbolo.</p>
          {sale.confirmPassword && sale.password !== sale.confirmPassword && <p className="text-xs font-bold text-rose-600 dark:text-rose-400">As senhas não coincidem.</p>}
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
            <Consent checked={sale.acceptTerms} onChange={(value) => setSale({ ...sale, acceptTerms: value })}>O cliente leu e aceitou os <a className="font-bold text-brand-700 underline dark:text-brand-300" href="/termos" target="_blank" rel="noreferrer">Termos de Uso</a>.</Consent>
            <Consent checked={sale.acceptPrivacy} onChange={(value) => setSale({ ...sale, acceptPrivacy: value })}>O cliente leu e aceitou a <a className="font-bold text-brand-700 underline dark:text-brand-300" href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.</Consent>
            <Consent checked={sale.acceptAutomatedAnalysis} onChange={(value) => setSale({ ...sale, acceptAutomatedAnalysis: value })}>O cliente autorizou a análise automatizada do cadastro.</Consent>
          </div>
          {mutation.error && <ErrorMessage error={mutation.error} />}
          <Button className="w-full" disabled={!sale.confirmPassword || sale.password !== sale.confirmPassword || !sale.acceptTerms || !sale.acceptPrivacy || !sale.acceptAutomatedAnalysis} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>Validar e iniciar teste grátis</Button>
          <p className="text-center text-[11px] text-slate-400">Marque os consentimentos somente após a autorização expressa do cliente. Não há pagamento agora; sua comissão só nasce se ele concluir o teste, pagar a mensalidade e o Asaas creditar o valor.</p>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, k, state, set, type = "text", mask }: any) {
  return <FormField label={label}>{mask ? <MaskedInput mask={mask} value={state[k]} onChange={(event) => set({ ...state, [k]: event.target.value })} /> : <Input type={type} value={state[k]} onChange={(event) => set({ ...state, [k]: event.target.value })} />}</FormField>;
}

function ErrorMessage({ error }: { error: unknown }) {
  return <p className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(error)}</p>;
}

function Consent({checked,onChange,children}:{checked:boolean;onChange:(value:boolean)=>void;children:React.ReactNode}) {
  return <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-orange-600" checked={checked} onChange={(event)=>onChange(event.target.checked)}/><span>{children}</span></label>;
}
