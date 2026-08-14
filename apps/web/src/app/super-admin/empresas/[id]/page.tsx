"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Company } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyGupshupLink } from "@/components/messaging/company-gupshup-link";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";
import { Badge } from "@/components/ui/badge";
import { SuperAdminCompanyAccessButton } from "@/components/auth/super-admin-company-access-button";

interface CompanyForm {
  name: string;
  slug: string;
  cnpj: string;
  phone: string;
  whatsapp: string;
  addressLine: string;
  city: string;
  state: string;
  deliveryFeeBase: string;
  avgDeliveryTimeMinutes: string;
  logoUrl: string;
}

interface SettingsForm {
  plan: string;
  maxUsers: string;
  maxProducts: string;
  aiEnabled: boolean;
  whatsappNumber: string;
}

interface AdminForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const EMPTY_COMPANY_FORM: CompanyForm = {
  name: "",
  slug: "",
  cnpj: "",
  phone: "",
  whatsapp: "",
  addressLine: "",
  city: "",
  state: "",
  deliveryFeeBase: "",
  avgDeliveryTimeMinutes: "",
  logoUrl: "",
};

const EMPTY_SETTINGS_FORM: SettingsForm = {
  plan: "BASICO",
  maxUsers: "",
  maxProducts: "",
  aiEnabled: true,
  whatsappNumber: "",
};

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const [companyForm, setCompanyForm] = useState<CompanyForm>(EMPTY_COMPANY_FORM);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(EMPTY_SETTINGS_FORM);
  const [adminForm, setAdminForm] = useState<AdminForm>({ name: "", email: "", password: "", confirmPassword: "" });

  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companySuccess, setCompanySuccess] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);

  const { data: company, isLoading } = useQuery({
    queryKey: ["super-admin-company", id],
    queryFn: async () => {
      const { data } = await api.get<Company>(`/companies/${id}`);
      return data;
    },
  });

  useEffect(() => {
    if (!company) return;
    setCompanyForm({
      name: company.name,
      slug: company.slug,
      cnpj: company.cnpj ?? "",
      phone: company.phone ?? "",
      whatsapp: company.whatsapp ?? "",
      addressLine: company.addressLine ?? "",
      city: company.city ?? "",
      state: company.state ?? "",
      deliveryFeeBase: String(company.deliveryFeeBase ?? ""),
      avgDeliveryTimeMinutes: String(company.avgDeliveryTimeMinutes ?? ""),
      logoUrl: company.logoUrl ?? "",
    });
    setSettingsForm({
      plan: company.settings?.plan ?? "BASICO",
      maxUsers: company.settings?.maxUsers != null ? String(company.settings.maxUsers) : "",
      maxProducts: company.settings?.maxProducts != null ? String(company.settings.maxProducts) : "",
      aiEnabled: company.settings?.aiEnabled ?? true,
      whatsappNumber: company.settings?.whatsappNumber ?? "",
    });
  }, [company]);

  const updateCompany = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<Company>(`/companies/${id}`, {
        name: companyForm.name,
        slug: companyForm.slug || undefined,
        cnpj: companyForm.cnpj || undefined,
        phone: companyForm.phone || undefined,
        whatsapp: companyForm.whatsapp || undefined,
        addressLine: companyForm.addressLine || undefined,
        city: companyForm.city || undefined,
        state: companyForm.state || undefined,
        deliveryFeeBase: companyForm.deliveryFeeBase ? Number(companyForm.deliveryFeeBase) : undefined,
        avgDeliveryTimeMinutes: companyForm.avgDeliveryTimeMinutes ? Number(companyForm.avgDeliveryTimeMinutes) : undefined,
        logoUrl: companyForm.logoUrl || undefined,
      });
      return data;
    },
    onSuccess: () => {
      setCompanyError(null);
      setCompanySuccess("Dados atualizados com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["super-admin-company", id] });
    },
    onError: (err) => {
      setCompanySuccess(null);
      setCompanyError(apiErrorMessage(err));
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<Company>(`/companies/${id}/status`, { isActive: !company?.isActive });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["super-admin-company", id] }),
  });

  const updateSettings = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch(`/companies/${id}/settings`, {
        plan: settingsForm.plan || undefined,
        maxUsers: settingsForm.maxUsers ? Number(settingsForm.maxUsers) : undefined,
        maxProducts: settingsForm.maxProducts ? Number(settingsForm.maxProducts) : undefined,
        aiEnabled: settingsForm.aiEnabled,
        whatsappNumber: settingsForm.whatsappNumber || undefined,
      });
      return data;
    },
    onSuccess: () => {
      setSettingsError(null);
      setSettingsSuccess("Configurações atualizadas com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["super-admin-company", id] });
    },
    onError: (err) => {
      setSettingsSuccess(null);
      setSettingsError(apiErrorMessage(err));
    },
  });

  const createAdmin = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/companies/${id}/admin`, adminForm);
      return data;
    },
    onSuccess: () => {
      setAdminError(null);
      setAdminSuccess("Administrador criado com sucesso.");
      setAdminForm({ name: "", email: "", password: "", confirmPassword: "" });
      queryClient.invalidateQueries({ queryKey: ["super-admin-company", id] });
    },
    onError: (err) => {
      setAdminSuccess(null);
      setAdminError(apiErrorMessage(err));
    },
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>;
  }

  if (!company) {
    return <p className="text-sm text-red-600 dark:text-red-400">Empresa não encontrada.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{company.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={company.isActive ? "success" : "danger"}>{company.isActive ? "Ativa" : "Inativa"}</Badge>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {company._count?.orders ?? 0} pedidos · {company._count?.users ?? 0} usuários
            </span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <SuperAdminCompanyAccessButton companyId={company.id} />
          <Button variant={company.isActive ? "danger" : "outline"} isLoading={toggleStatus.isPending} onClick={() => toggleStatus.mutate()}>
            {company.isActive ? "Desativar empresa" : "Ativar empresa"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados gerais</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              updateCompany.mutate();
            }}
          >
            <FormField label="Nome *">
              <Input
                required
                value={companyForm.name}
                onChange={(e) => setCompanyForm((f) => ({ ...f, name: e.target.value }))}
              />
            </FormField>
            <FormField label="Slug">
              <Input value={companyForm.slug} onChange={(e) => setCompanyForm((f) => ({ ...f, slug: e.target.value }))} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="CNPJ">
                <MaskedInput mask="document" value={companyForm.cnpj} onChange={(e) => setCompanyForm((f) => ({ ...f, cnpj: e.target.value }))} />
              </FormField>
              <FormField label="Telefone">
                <MaskedInput mask="phone" value={companyForm.phone} onChange={(e) => setCompanyForm((f) => ({ ...f, phone: e.target.value }))} />
              </FormField>
              <FormField label="WhatsApp">
                <MaskedInput mask="phone"
                  value={companyForm.whatsapp}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, whatsapp: e.target.value }))}
                />
              </FormField>
              <FormField label="Logo (URL)">
                <Input value={companyForm.logoUrl} onChange={(e) => setCompanyForm((f) => ({ ...f, logoUrl: e.target.value }))} />
              </FormField>
            </div>
            <FormField label="Endereço">
              <Input
                value={companyForm.addressLine}
                onChange={(e) => setCompanyForm((f) => ({ ...f, addressLine: e.target.value }))}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Cidade">
                <Input value={companyForm.city} onChange={(e) => setCompanyForm((f) => ({ ...f, city: e.target.value }))} />
              </FormField>
              <FormField label="UF">
                <BrazilStateSelect value={companyForm.state} onChange={(e) => setCompanyForm((f) => ({ ...f, state: e.target.value }))} />
              </FormField>
              <FormField label="Taxa de entrega base (R$)">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={companyForm.deliveryFeeBase}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, deliveryFeeBase: e.target.value }))}
                />
              </FormField>
              <FormField label="Tempo médio de entrega (min)">
                <Input
                  type="number"
                  min="1"
                  value={companyForm.avgDeliveryTimeMinutes}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, avgDeliveryTimeMinutes: e.target.value }))}
                />
              </FormField>
            </div>

            {companyError && <p className="text-sm text-red-600 dark:text-red-400">{companyError}</p>}
            {companySuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">{companySuccess}</p>}

            <Button type="submit" isLoading={updateCompany.isPending}>
              Salvar dados gerais
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plano e limites</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              updateSettings.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Plano">
                <Select value={settingsForm.plan} onChange={(e) => setSettingsForm((f) => ({ ...f, plan: e.target.value }))}>
                  <option value="BASICO">Básico</option>
                  <option value="PROFISSIONAL">Profissional</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </Select>
              </FormField>
              <FormField label="Número de WhatsApp (IA)">
                <Input
                  value={settingsForm.whatsappNumber}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
                />
              </FormField>
              <FormField label="Limite de usuários">
                <Input
                  type="number"
                  min="1"
                  value={settingsForm.maxUsers}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, maxUsers: e.target.value }))}
                />
              </FormField>
              <FormField label="Limite de produtos">
                <Input
                  type="number"
                  min="1"
                  value={settingsForm.maxProducts}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, maxProducts: e.target.value }))}
                />
              </FormField>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={settingsForm.aiEnabled}
                onChange={(e) => setSettingsForm((f) => ({ ...f, aiEnabled: e.target.checked }))}
              />
              IA habilitada para esta empresa
            </label>

            {settingsError && <p className="text-sm text-red-600 dark:text-red-400">{settingsError}</p>}
            {settingsSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">{settingsSuccess}</p>}

            <Button type="submit" isLoading={updateSettings.isPending}>
              Salvar plano e limites
            </Button>
          </form>
        </CardContent>
      </Card>

      <CompanyGupshupLink companyId={id} />

      <Card>
        <CardHeader>
          <CardTitle>Criar administrador</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Esta é a única forma de a empresa ganhar um usuário ADMIN — empresas não se autocadastram.
          </p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createAdmin.mutate();
            }}
          >
            <FormField label="Nome *">
              <Input required value={adminForm.name} onChange={(e) => setAdminForm((f) => ({ ...f, name: e.target.value }))} />
            </FormField>
            <FormField label="E-mail *">
              <Input
                type="email"
                required
                value={adminForm.email}
                onChange={(e) => setAdminForm((f) => ({ ...f, email: e.target.value }))}
              />
            </FormField>
            <FormField label="Senha *">
              <Input
                type="password"
                required
                minLength={8}
                pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}"
                title="Use ao menos 8 caracteres, uma letra maiúscula, uma minúscula e um símbolo."
                value={adminForm.password}
                onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
              />
              <p className="text-xs leading-5 text-slate-400">Mínimo de 8 caracteres, com maiúscula, minúscula e símbolo.</p>
            </FormField>
            <FormField label="Confirmar senha *">
              <Input
                type="password"
                required
                value={adminForm.confirmPassword}
                onChange={(e) => setAdminForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              />
              {adminForm.confirmPassword && adminForm.password !== adminForm.confirmPassword && <p className="text-xs font-bold text-rose-600 dark:text-rose-400">As senhas não coincidem.</p>}
            </FormField>

            {adminError && <p className="text-sm text-red-600 dark:text-red-400">{adminError}</p>}
            {adminSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">{adminSuccess}</p>}

            <Button type="submit" disabled={!adminForm.confirmPassword || adminForm.password !== adminForm.confirmPassword} isLoading={createAdmin.isPending}>
              Criar administrador
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
