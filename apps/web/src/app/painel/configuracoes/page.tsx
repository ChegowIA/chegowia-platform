"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PaymentMethod } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Company } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";

const WEEKDAYS = [
  { key: "segunda", label: "Segunda" },
  { key: "terca", label: "Terça" },
  { key: "quarta", label: "Quarta" },
  { key: "quinta", label: "Quinta" },
  { key: "sexta", label: "Sexta" },
  { key: "sabado", label: "Sábado" },
  { key: "domingo", label: "Domingo" },
];

export default function ConfiguracoesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: company, isLoading } = useQuery({
    queryKey: ["company-me"],
    queryFn: async () => {
      const { data } = await api.get<Company>("/companies/me");
      return data;
    },
  });

  const [generalForm, setGeneralForm] = useState({
    name: "",
    cnpj: "",
    phone: "",
    whatsapp: "",
    addressLine: "",
    city: "",
    state: "",
    deliveryFeeBase: "",
    avgDeliveryTimeMinutes: "",
    logoUrl: "",
  });

  const [openingHours, setOpeningHours] = useState<Record<string, string>>({});
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiKnowledgeBase, setAiKnowledgeBase] = useState("");
  const [settingsWhatsapp, setSettingsWhatsapp] = useState("");
  const [channelWhatsapp, setChannelWhatsapp] = useState("");

  useEffect(() => {
    if (!company) return;
    setGeneralForm({
      name: company.name ?? "",
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
    setOpeningHours(company.settings?.openingHours ?? {});
    setPaymentMethods(company.settings?.paymentMethodsEnabled ?? []);
    setAiEnabled(company.settings?.aiEnabled ?? true);
    setAiKnowledgeBase(company.settings?.aiKnowledgeBase ?? "");
    setSettingsWhatsapp(company.settings?.whatsappNumber ?? "");
    setChannelWhatsapp(company.whatsapp ?? "");
  }, [company]);

  const saveGeneral = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch("/companies/me", {
        name: generalForm.name,
        cnpj: generalForm.cnpj || undefined,
        phone: generalForm.phone || undefined,
        whatsapp: generalForm.whatsapp || undefined,
        addressLine: generalForm.addressLine || undefined,
        city: generalForm.city || undefined,
        state: generalForm.state || undefined,
        deliveryFeeBase: generalForm.deliveryFeeBase ? Number(generalForm.deliveryFeeBase) : undefined,
        avgDeliveryTimeMinutes: generalForm.avgDeliveryTimeMinutes
          ? Number(generalForm.avgDeliveryTimeMinutes)
          : undefined,
        logoUrl: generalForm.logoUrl || undefined,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("Dados gerais atualizados.");
      queryClient.invalidateQueries({ queryKey: ["company-me"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch("/companies/me/settings", {
        openingHours,
        paymentMethodsEnabled: paymentMethods,
        aiEnabled,
        aiKnowledgeBase,
        whatsappNumber: settingsWhatsapp || undefined,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("Configurações atualizadas.");
      queryClient.invalidateQueries({ queryKey: ["company-me"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const saveWhatsappChannel = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch("/messaging/channel/whatsapp", { number: channelWhatsapp });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("WhatsApp da empresa configurado.");
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function togglePaymentMethod(method: string) {
    setPaymentMethods((list) => (list.includes(method) ? list.filter((m) => m !== method) : [...list, method]));
  }

  if (isLoading) return <p className="text-sm text-slate-500">Carregando...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Configurações</h1>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20">{error}</p>}
      {success && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20">{success}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dados gerais</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Nome">
            <Input value={generalForm.name} onChange={(e) => setGeneralForm((f) => ({ ...f, name: e.target.value }))} />
          </FormField>
          <FormField label="CNPJ">
            <Input value={generalForm.cnpj} onChange={(e) => setGeneralForm((f) => ({ ...f, cnpj: e.target.value }))} />
          </FormField>
          <FormField label="Telefone">
            <Input value={generalForm.phone} onChange={(e) => setGeneralForm((f) => ({ ...f, phone: e.target.value }))} />
          </FormField>
          <FormField label="WhatsApp">
            <Input
              value={generalForm.whatsapp}
              onChange={(e) => setGeneralForm((f) => ({ ...f, whatsapp: e.target.value }))}
            />
          </FormField>
          <FormField label="Endereço">
            <Input
              value={generalForm.addressLine}
              onChange={(e) => setGeneralForm((f) => ({ ...f, addressLine: e.target.value }))}
            />
          </FormField>
          <FormField label="Cidade">
            <Input value={generalForm.city} onChange={(e) => setGeneralForm((f) => ({ ...f, city: e.target.value }))} />
          </FormField>
          <FormField label="Estado">
            <Input value={generalForm.state} onChange={(e) => setGeneralForm((f) => ({ ...f, state: e.target.value }))} />
          </FormField>
          <FormField label="Taxa de entrega base">
            <Input
              type="number"
              step="0.01"
              value={generalForm.deliveryFeeBase}
              onChange={(e) => setGeneralForm((f) => ({ ...f, deliveryFeeBase: e.target.value }))}
            />
          </FormField>
          <FormField label="Tempo médio de entrega (min)">
            <Input
              type="number"
              value={generalForm.avgDeliveryTimeMinutes}
              onChange={(e) => setGeneralForm((f) => ({ ...f, avgDeliveryTimeMinutes: e.target.value }))}
            />
          </FormField>
          <FormField label="URL do logo">
            <Input
              value={generalForm.logoUrl}
              onChange={(e) => setGeneralForm((f) => ({ ...f, logoUrl: e.target.value }))}
            />
          </FormField>
          <div className="sm:col-span-2">
            <Button isLoading={saveGeneral.isPending} onClick={() => saveGeneral.mutate()}>
              Salvar dados gerais
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horário de funcionamento</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {WEEKDAYS.map((day) => (
            <FormField key={day.key} label={day.label}>
              <Input
                placeholder="08:00-18:00 ou Fechado"
                value={openingHours[day.key] ?? ""}
                onChange={(e) => setOpeningHours((h) => ({ ...h, [day.key]: e.target.value }))}
              />
            </FormField>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formas de pagamento aceitas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {Object.values(PaymentMethod).map((method) => (
            <label key={method} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={paymentMethods.includes(method)}
                onChange={() => togglePaymentMethod(method)}
              />
              {method.replaceAll("_", " ")}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agente de IA — treinamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            Agente de IA ativado
          </label>
          <FormField label="Base de conhecimento do agente (o que ele deve saber sobre a empresa: cardápio, horários, políticas, tom de voz, etc.)">
            <Textarea
              rows={10}
              placeholder="Ex: Somos uma pizzaria que funciona de terça a domingo. Não aceitamos trocas após a entrega. Nosso diferencial é..."
              value={aiKnowledgeBase}
              onChange={(e) => setAiKnowledgeBase(e.target.value)}
            />
          </FormField>
          <FormField label="Número de WhatsApp usado pelo agente (configurações da IA)">
            <Input value={settingsWhatsapp} onChange={(e) => setSettingsWhatsapp(e.target.value)} />
          </FormField>
          <Button isLoading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
            Salvar configurações
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Canal de WhatsApp (links wa.me)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormField label="Número do WhatsApp (com DDI e DDD)">
            <Input
              placeholder="5511999999999"
              value={channelWhatsapp}
              onChange={(e) => setChannelWhatsapp(e.target.value)}
            />
          </FormField>
          <Button isLoading={saveWhatsappChannel.isPending} onClick={() => saveWhatsappChannel.mutate()}>
            Salvar WhatsApp
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
