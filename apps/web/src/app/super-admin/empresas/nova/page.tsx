"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Company } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

interface CreateCompanyForm {
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

const INITIAL_FORM: CreateCompanyForm = {
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

export default function NewCompanyPage() {
  const [form, setForm] = useState<CreateCompanyForm>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const createCompany = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Company>("/companies", {
        name: form.name,
        slug: form.slug || undefined,
        cnpj: form.cnpj || undefined,
        phone: form.phone || undefined,
        whatsapp: form.whatsapp || undefined,
        addressLine: form.addressLine || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        deliveryFeeBase: form.deliveryFeeBase ? Number(form.deliveryFeeBase) : undefined,
        avgDeliveryTimeMinutes: form.avgDeliveryTimeMinutes ? Number(form.avgDeliveryTimeMinutes) : undefined,
        logoUrl: form.logoUrl || undefined,
      });
      return data;
    },
    onSuccess: (data) => router.replace(`/super-admin/empresas/${data.id}`),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function update<K extends keyof CreateCompanyForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createCompany.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Nova empresa</h1>

      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <FormField label="Nome *">
              <Input required value={form.name} onChange={(e) => update("name", e.target.value)} />
            </FormField>
            <FormField label="Slug (opcional, gerado automaticamente se vazio)">
              <Input value={form.slug} onChange={(e) => update("slug", e.target.value)} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="CNPJ">
                <Input value={form.cnpj} onChange={(e) => update("cnpj", e.target.value)} />
              </FormField>
              <FormField label="Telefone">
                <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              </FormField>
              <FormField label="WhatsApp">
                <Input value={form.whatsapp} onChange={(e) => update("whatsapp", e.target.value)} />
              </FormField>
              <FormField label="Logo (URL)">
                <Input value={form.logoUrl} onChange={(e) => update("logoUrl", e.target.value)} />
              </FormField>
            </div>
            <FormField label="Endereço">
              <Input value={form.addressLine} onChange={(e) => update("addressLine", e.target.value)} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Cidade">
                <Input value={form.city} onChange={(e) => update("city", e.target.value)} />
              </FormField>
              <FormField label="UF">
                <Input maxLength={2} value={form.state} onChange={(e) => update("state", e.target.value.toUpperCase())} />
              </FormField>
              <FormField label="Taxa de entrega base (R$)">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.deliveryFeeBase}
                  onChange={(e) => update("deliveryFeeBase", e.target.value)}
                />
              </FormField>
              <FormField label="Tempo médio de entrega (min)">
                <Input
                  type="number"
                  min="1"
                  value={form.avgDeliveryTimeMinutes}
                  onChange={(e) => update("avgDeliveryTimeMinutes", e.target.value)}
                />
              </FormField>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" isLoading={createCompany.isPending}>
              Criar empresa
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
