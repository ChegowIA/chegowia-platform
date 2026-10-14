"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useOwnedCompanies, useSwitchUnit } from "@/components/layout/unit-switcher";
import { useAuthStore } from "@/lib/auth-store";

type UnitForm = {
  name: string; cnpj: string; phone: string; addressLine: string;
  city: string; state: string; zipCode: string; adminName: string; adminEmail: string; shareCnpj: boolean;
};

const emptyForm: UnitForm = { name: "", cnpj: "", phone: "", addressLine: "", city: "", state: "", zipCode: "", adminName: "", adminEmail: "", shareCnpj: false };

export default function UnitsPage() {
  const user = useAuthStore((state) => state.user);
  const { data, isLoading, error, refetch } = useOwnedCompanies();
  const switchUnit = useSwitchUnit();
  const [form, setForm] = useState<UnitForm>(emptyForm);
  const [prefilled, setPrefilled] = useState(false);
  const [invitationWarning, setInvitationWarning] = useState<string | null>(null);
  const active = data?.companies.find((unit) => unit.id === data.activeCompanyId);
  const canCreateUnit = active?.ownerUserId
    ? active.ownerUserId === user?.id
    : active?.users?.length === 1 && active.users[0].id === user?.id;

  useEffect(() => {
    if (!active || prefilled) return;
    setForm((current) => ({ ...current, phone: active.phone ?? "", city: active.city ?? "", state: active.state ?? "" }));
    setPrefilled(true);
  }, [active, prefilled]);

  const createUnit = useMutation({
    mutationFn: async (payload: UnitForm) => (await api.post<{ id: string; adminEmail: string; invitationSent: boolean }>("/companies/my-units", payload)).data,
    onSuccess: async (created) => {
      await refetch();
      if (!created.invitationSent) {
        setInvitationWarning(`A unidade foi criada, mas o convite para ${created.adminEmail} não saiu. Reenvie-o abaixo antes de entregar o acesso.`);
        return;
      }
      switchUnit.mutate({ companyId: created.id, destination: "/painel/configuracoes" });
    },
  });
  const resendInvitation = useMutation({
    mutationFn: async (id: string) => (await api.post<{ invitationSent: boolean }>(`/companies/my-units/${id}/admin-invite`)).data,
    onSuccess: async (result) => {
      setInvitationWarning(result.invitationSent ? "Convite reenviado para o administrador da unidade." : "O convite ainda não pôde ser enviado. Confira o serviço de e-mail.");
      await refetch();
    },
  });
  const publication = useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) =>
      (await api.patch(`/companies/my-units/${id}/publication`, { published })).data,
    onSuccess: () => void refetch(),
  });

  const update = (key: Exclude<keyof UnitForm, "shareCnpj">, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createUnit.mutate(form);
  };

  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="rounded-[28px] bg-slate-950 p-6 text-white sm:p-8">
      <p className="text-xs font-black uppercase tracking-[.16em] text-brand-300">Gestão de unidades</p>
      <h1 className="mt-2 text-3xl font-black">Uma conta, operações independentes</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Cada unidade tem painel, cardápio, pedidos, equipe, relatórios, assinatura e consumo de IA/WhatsApp próprios. Troque de unidade sem criar outro login.</p>
    </header>

    <section className="rounded-[24px] border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <h2 className="text-xl font-black">Suas unidades</h2>
      {isLoading && <p className="mt-3 text-sm text-slate-500">Carregando unidades…</p>}
      {error && <p className="mt-3 text-sm text-rose-600">{apiErrorMessage(error)}</p>}
      {invitationWarning && <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">{invitationWarning}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {data?.companies.map((unit) => <div key={unit.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-start justify-between gap-2">
            <div><p className="font-black text-slate-950 dark:text-white">{unit.name}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{[unit.city, unit.state].filter(Boolean).join(" / ")}</p></div>
            {unit.id === data.activeCompanyId && <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">ATIVA NO PAINEL</span>}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Assinatura: {unit.subscription?.status?.replaceAll("_", " ").toLowerCase() ?? "não configurada"}</p>
          <p className="mt-1 text-xs font-bold text-slate-700 dark:text-slate-300">{unit.isPublished ? "Visível no catálogo" : "Ainda não publicada"}</p>
          {unit.ownerUserId && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Administrador local: {unit.users?.find((admin) => admin.id !== unit.ownerUserId)?.email ?? "não informado"}</p>}
          {unit.ownerUserId === user?.id && unit.users?.some((admin) => admin.id !== unit.ownerUserId && !admin.emailVerifiedAt) && <button type="button" disabled={resendInvitation.isPending} onClick={() => resendInvitation.mutate(unit.id)} className="mt-3 rounded-xl border border-amber-400 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200">Reenviar convite do administrador</button>}
          {unit.id !== data.activeCompanyId && <button type="button" disabled={!unit.isActive || switchUnit.isPending} onClick={() => switchUnit.mutate({ companyId: unit.id })} className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50">Abrir painel desta unidade</button>}
          <button type="button" disabled={publication.isPending} onClick={() => publication.mutate({ id: unit.id, published: !unit.isPublished })} className="mt-3 ml-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 transition hover:border-brand-500 hover:text-brand-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-100">{unit.isPublished ? "Ocultar loja" : "Publicar loja"}</button>
        </div>)}
      </div>
      {switchUnit.error && <p className="mt-3 text-sm text-rose-600">{apiErrorMessage(switchUnit.error)}</p>}
      {publication.error && <p className="mt-3 text-sm text-rose-600">{apiErrorMessage(publication.error)}</p>}
      {resendInvitation.error && <p className="mt-3 text-sm text-rose-600">{apiErrorMessage(resendInvitation.error)}</p>}
    </section>

    {canCreateUnit && <section className="rounded-[24px] border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <h2 className="text-xl font-black">Cadastrar outra unidade</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Informe a identificação da nova loja e quem vai administrá-la no dia a dia. O titular da matriz mantém acesso pelo seletor; o administrador local entra com seu próprio e-mail, senha e código de segurança. Cada estabelecimento físico usa seu CNPJ completo, embora filiais da mesma pessoa jurídica compartilhem a raiz.</p>
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100">
        {active?.isTestOnly
          ? "Esta unidade continuará sendo demonstração: sem cobrança real e visível somente para a conta de teste autorizada quando estiver dentro do raio de entrega."
          : "A nova unidade começa com 7 dias de teste próprios. Se você decidir mantê-la, ela terá mensalidade e uso de IA/WhatsApp cobrados separadamente. O número e canal da API WhatsApp também precisam ser configurados para esta unidade."}
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Nome da unidade" value={form.name} onChange={(value) => update("name", value)} placeholder="Ex.: Pizzaria Centro" />
        <Field label={active?.isTestOnly ? "CNPJ (opcional na demonstração)" : "CNPJ da unidade"} value={form.cnpj} onChange={(value) => update("cnpj", value.toUpperCase())} placeholder="Numérico ou alfanumérico" required={!active?.isTestOnly} />
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 sm:col-span-2">
          <input type="checkbox" checked={form.shareCnpj} onChange={(event) => setForm((current) => ({ ...current, shareCnpj: event.target.checked }))} />
          Esta é outra operação no mesmo endereço físico e usa o mesmo CNPJ completo já cadastrado na minha conta.
        </label>
        <Field label="Telefone" value={form.phone} onChange={(value) => update("phone", value)} placeholder="(62) 0000-0000" inputMode="tel" />
        <Field label="CEP" value={form.zipCode} onChange={(value) => update("zipCode", value)} placeholder="00000-000" inputMode="numeric" />
        <div className="sm:col-span-2"><Field label="Endereço da loja" value={form.addressLine} onChange={(value) => update("addressLine", value)} placeholder="Rua, número e bairro" /></div>
        <Field label="Cidade" value={form.city} onChange={(value) => update("city", value)} />
        <Field label="UF" value={form.state} onChange={(value) => update("state", value)} placeholder="GO" maxLength={2} />
        <Field label="Nome do administrador local" value={form.adminName} onChange={(value) => update("adminName", value)} placeholder="Nome completo" />
        <Field label="E-mail do administrador local" value={form.adminEmail} onChange={(value) => update("adminEmail", value)} placeholder="admin@empresa.com.br" inputMode="email" />
        <div className="sm:col-span-2">
          <button type="submit" disabled={createUnit.isPending || switchUnit.isPending} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-black text-white transition hover:bg-brand-700 disabled:opacity-50">{createUnit.isPending || switchUnit.isPending ? "Criando unidade…" : "Criar unidade e abrir configurações"}</button>
          {createUnit.error && <p className="mt-3 text-sm text-rose-600">{apiErrorMessage(createUnit.error)}</p>}
          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">Antes de receber pedidos, confirme no mapa o ponto exato de saída da loja. Produtos, funcionários e WhatsApp não são copiados automaticamente.</p>
        </div>
      </form>
    </section>}
  </div>;
}

function Field({ label, value, onChange, placeholder, inputMode, maxLength, required = true }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
  inputMode?: "numeric" | "tel" | "email"; maxLength?: number; required?: boolean;
}) {
  return <label className="block text-sm font-bold text-slate-800 dark:text-slate-200">{label}
    <input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base font-medium text-slate-950 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
  </label>;
}
