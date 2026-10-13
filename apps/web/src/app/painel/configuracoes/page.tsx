"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PaymentMethod } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Company, CompanySettings } from "@/lib/types";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";
import { ProductImage } from "@/components/catalog/product-image";
import { WhatsAppGupshupSettings } from "@/components/messaging/whatsapp-gupshup-settings";
import { ChangePasswordCard } from "@/components/auth/change-password-card";
import { DeliveryPin, DeliveryPinPicker } from "@/components/deliveries/delivery-pin-picker";

const WEEKDAYS = [
  { key: "segunda", label: "Segunda" },
  { key: "terca", label: "Terça" },
  { key: "quarta", label: "Quarta" },
  { key: "quinta", label: "Quinta" },
  { key: "sexta", label: "Sexta" },
  { key: "sabado", label: "Sábado" },
  { key: "domingo", label: "Domingo" },
] as const;

type WeekdayKey = (typeof WEEKDAYS)[number]["key"];
type OpeningHourDraft = {
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
};
type OpeningHoursDraft = Record<WeekdayKey, OpeningHourDraft>;

function openingHoursDraft(hours?: Record<string, string> | null): OpeningHoursDraft {
  return Object.fromEntries(
    WEEKDAYS.map(({ key }) => {
      const saved = String(hours?.[key] ?? "").trim();
      const match = saved.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
      return [key, match
        ? { isOpen: true, opensAt: match[1], closesAt: match[2] }
        : { isOpen: false, opensAt: "18:00", closesAt: "23:00" }];
    }),
  ) as OpeningHoursDraft;
}

function serializeOpeningHours(hours: OpeningHoursDraft): Record<string, string> {
  return Object.fromEntries(
    WEEKDAYS.map(({ key }) => {
      const day = hours[key];
      return [key, day.isOpen ? `${day.opensAt}-${day.closesAt}` : "Fechado"];
    }),
  );
}

export default function ConfiguracoesPage() {
  const queryClient = useQueryClient();
  const hydratedCompanyId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [companyPin, setCompanyPin] = useState<DeliveryPin | null>(null);
  const [pinConfirmed, setPinConfirmed] = useState(false);

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
    zipCode: "",
    deliveryFeeBase: "",
    deliveryFeePerKm: "",
    deliveryRadiusKm: "",
    avgDeliveryTimeMinutes: "",
    logoUrl: "",
  });

  const [openingHours, setOpeningHours] = useState<OpeningHoursDraft>(() => openingHoursDraft());
  const [storeImageFile, setStoreImageFile] = useState<File | null>(null);
  const [storeImagePreviewUrl, setStoreImagePreviewUrl] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiKnowledgeBase, setAiKnowledgeBase] = useState("");
  const [settingsWhatsapp, setSettingsWhatsapp] = useState("");

  useEffect(() => {
    if (!storeImageFile) {
      setStoreImagePreviewUrl(generalForm.logoUrl || null);
      return;
    }
    const objectUrl = URL.createObjectURL(storeImageFile);
    setStoreImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [generalForm.logoUrl, storeImageFile]);

  useEffect(() => {
    if (!company) {
      hydratedCompanyId.current = null;
      return;
    }
    if (hydratedCompanyId.current === company.id) return;
    setGeneralForm({
      name: company.name ?? "",
      cnpj: company.cnpj ?? "",
      phone: company.phone ?? "",
      whatsapp: company.whatsapp ?? "",
      addressLine: company.addressLine ?? "",
      city: company.city ?? "",
      state: company.state ?? "",
      zipCode: company.zipCode ?? "",
      deliveryFeeBase: String(company.deliveryFeeBase ?? ""),
      deliveryFeePerKm: String(company.deliveryFeePerKm ?? ""),
      deliveryRadiusKm: String(company.deliveryRadiusKm ?? ""),
      avgDeliveryTimeMinutes: String(company.avgDeliveryTimeMinutes ?? ""),
      logoUrl: company.logoUrl ?? "",
    });
    setCompanyPin(company.latitude != null && company.longitude != null
      ? { latitude: Number(company.latitude), longitude: Number(company.longitude) }
      : null);
    setPinConfirmed(Boolean(company.locationConfirmedAt));
    setOpeningHours(openingHoursDraft(company.settings?.openingHours));
    setPaymentMethods(company.settings?.paymentMethodsEnabled ?? []);
    setAiEnabled(company.settings?.aiEnabled ?? true);
    setAiKnowledgeBase(company.settings?.aiKnowledgeBase ?? "");
    setSettingsWhatsapp(company.settings?.whatsappNumber ?? "");
    hydratedCompanyId.current = company.id;
  }, [company]);

  function changeCompanyAddress(field: "addressLine" | "city" | "state" | "zipCode", value: string) {
    setGeneralForm((current) => ({ ...current, [field]: value }));
    setCompanyPin(null);
    setPinConfirmed(false);
  }

  function updateCachedSettings(patch: Partial<CompanySettings>) {
    queryClient.setQueryData<Company>(["company-me"], (current) => {
      if (!current) return current;
      return {
        ...current,
        settings: {
          ...current.settings,
          ...patch,
        } as CompanySettings,
      };
    });
  }

  const saveGeneral = useMutation({
    mutationFn: async ({ point, confirmingPin = false }: { point: DeliveryPin; confirmingPin?: boolean }) => {
      if (!confirmingPin && !pinConfirmed) throw new Error("Confirme no mapa o ponto de saída da loja.");
      if (!generalForm.addressLine.trim() || !generalForm.city.trim() || !generalForm.state || generalForm.zipCode.replace(/\D/g, "").length !== 8) {
        throw new Error("Preencha endereço, cidade, estado e CEP antes de salvar o ponto da loja.");
      }
      const addressAndPoint = {
        latitude: point.latitude,
        longitude: point.longitude,
        addressLine: generalForm.addressLine,
        city: generalForm.city,
        state: generalForm.state,
        zipCode: generalForm.zipCode,
      };
      const { data } = await api.patch<Company>("/companies/me", confirmingPin ? addressAndPoint : {
        ...addressAndPoint,
        name: generalForm.name,
        cnpj: generalForm.cnpj || undefined,
        phone: generalForm.phone || undefined,
        whatsapp: generalForm.whatsapp || undefined,
        deliveryFeeBase: generalForm.deliveryFeeBase ? Number(generalForm.deliveryFeeBase) : undefined,
        deliveryFeePerKm: generalForm.deliveryFeePerKm ? Number(generalForm.deliveryFeePerKm) : undefined,
        deliveryRadiusKm: generalForm.deliveryRadiusKm ? Number(generalForm.deliveryRadiusKm) : undefined,
        avgDeliveryTimeMinutes: generalForm.avgDeliveryTimeMinutes
          ? Number(generalForm.avgDeliveryTimeMinutes)
          : undefined,
        logoUrl: generalForm.logoUrl || undefined,
      });
      if (confirmingPin || !storeImageFile) return data;

      const formData = new FormData();
      formData.append("file", storeImageFile);
      const uploaded = await api.post<Company>("/companies/me/logo", formData);
      return uploaded.data;
    },
    onSuccess: (saved: Company, { confirmingPin }) => {
      setError(null);
      setSuccess(confirmingPin ? "Ponto de saída salvo. A loja já pode calcular o frete a partir dele." : "Dados gerais atualizados.");
      if (!confirmingPin) {
        setStoreImageFile(null);
        setGeneralForm((form) => ({ ...form, logoUrl: saved.logoUrl ?? form.logoUrl }));
      }
      setCompanyPin(saved.latitude != null && saved.longitude != null
        ? { latitude: Number(saved.latitude), longitude: Number(saved.longitude) }
        : null);
      setPinConfirmed(Boolean(saved.locationConfirmedAt));
      queryClient.setQueryData<Company>(["company-me"], saved);
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const savePaymentMethods = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch("/companies/me/settings", {
        paymentMethodsEnabled: paymentMethods,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("Formas de pagamento atualizadas.");
      updateCachedSettings({ paymentMethodsEnabled: paymentMethods });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const saveAiTraining = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch("/companies/me/settings", {
        aiEnabled,
        aiKnowledgeBase,
        whatsappNumber: settingsWhatsapp.trim() || null,
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("Configurações do agente de IA atualizadas.");
      updateCachedSettings({
        aiEnabled,
        aiKnowledgeBase,
        whatsappNumber: settingsWhatsapp.trim() || null,
      });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const saveOpeningHours = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch("/companies/me/settings", {
        openingHours: serializeOpeningHours(openingHours),
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("Horário de funcionamento atualizado.");
      updateCachedSettings({ openingHours: serializeOpeningHours(openingHours) });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function togglePaymentMethod(method: string) {
    setPaymentMethods((list) => (list.includes(method) ? list.filter((m) => m !== method) : [...list, method]));
  }

  function updateOpeningHour<K extends keyof OpeningHourDraft>(day: WeekdayKey, field: K, value: OpeningHourDraft[K]) {
    setOpeningHours((hours) => ({
      ...hours,
      [day]: { ...hours[day], [field]: value },
    }));
  }

  if (isLoading) return <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Configurações</h1>

      {company && !company.locationConfirmedAt && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Confirme a entrada da loja no mapa para que o frete de novos pedidos pelo site não seja calculado pelo centro do CEP. <a className="font-bold underline" href="#ponto-saida-entrega">Ir ao mapa</a>
        </p>
      )}

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      {success && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{success}</p>
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
            <MaskedInput mask="document" value={generalForm.cnpj} onChange={(e) => setGeneralForm((f) => ({ ...f, cnpj: e.target.value }))} />
          </FormField>
          <FormField label="Telefone">
            <MaskedInput mask="phone" value={generalForm.phone} onChange={(e) => setGeneralForm((f) => ({ ...f, phone: e.target.value }))} />
          </FormField>
          <FormField label="WhatsApp">
            <MaskedInput mask="phone"
              value={generalForm.whatsapp}
              onChange={(e) => setGeneralForm((f) => ({ ...f, whatsapp: e.target.value }))}
            />
          </FormField>
          <FormField label="Endereço">
            <Input
              required
              value={generalForm.addressLine}
              onChange={(e) => changeCompanyAddress("addressLine", e.target.value)}
            />
          </FormField>
          <FormField label="Cidade">
            <Input required value={generalForm.city} onChange={(e) => changeCompanyAddress("city", e.target.value)} />
          </FormField>
          <FormField label="Estado">
            <BrazilStateSelect required value={generalForm.state} onChange={(e) => changeCompanyAddress("state", e.target.value)} />
          </FormField>
          <FormField label="CEP operacional">
            <MaskedInput mask="cep" required value={generalForm.zipCode} onChange={(e) => changeCompanyAddress("zipCode", e.target.value)} />
          </FormField>
          <FormField label="Taxa de entrega base">
            <Input
              type="number"
              step="0.01"
              value={generalForm.deliveryFeeBase}
              onChange={(e) => setGeneralForm((f) => ({ ...f, deliveryFeeBase: e.target.value }))}
            />
          </FormField>
          <FormField label="Taxa por km da rota">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={generalForm.deliveryFeePerKm}
              onChange={(e) => setGeneralForm((f) => ({ ...f, deliveryFeePerKm: e.target.value }))}
            />
          </FormField>
          <FormField label="Raio máximo de entrega (km)">
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={generalForm.deliveryRadiusKm}
              onChange={(e) => setGeneralForm((f) => ({ ...f, deliveryRadiusKm: e.target.value }))}
            />
          </FormField>
          <FormField label="Tempo médio de entrega (min)">
            <Input
              type="number"
              value={generalForm.avgDeliveryTimeMinutes}
              onChange={(e) => setGeneralForm((f) => ({ ...f, avgDeliveryTimeMinutes: e.target.value }))}
            />
          </FormField>
          <div id="ponto-saida-entrega" className="sm:col-span-2 scroll-mt-24">
            <DeliveryPinPicker
              context="store"
              lookup={{ addressLine: generalForm.addressLine, city: generalForm.city, state: generalForm.state, zipCode: generalForm.zipCode }}
              point={companyPin}
              confirmed={pinConfirmed}
              confirming={saveGeneral.isPending}
              onPointChange={(next) => {
                if (saveGeneral.isPending) return;
                setCompanyPin(next);
                setPinConfirmed(false);
              }}
              onConfirm={() => {
                if (companyPin) saveGeneral.mutate({ point: companyPin, confirmingPin: true });
              }}
            />
            {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">A rota e a taxa de entrega começam neste ponto. Pedidos pelo site exigem esta confirmação para evitar fretes calculados pelo centro do CEP.</p>
          </div>
          <div className="sm:col-span-2 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-[144px_1fr] dark:border-slate-700 dark:bg-slate-900/40">
            <ProductImage src={storeImagePreviewUrl} alt={generalForm.name || "Imagem da loja"} className="h-36 w-full rounded-xl" />
            <div className="space-y-3">
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Imagem da loja</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Essa imagem aparece no catálogo e na página pública da loja.</p>
              </div>
              <label className="block cursor-pointer rounded-xl border border-dashed border-brand-200 bg-brand-50 px-4 py-3 text-sm font-bold text-brand-800 transition hover:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-200">
                Escolher imagem da loja
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  onChange={(event) => setStoreImageFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <FormField label="Ou informe uma URL de imagem">
                <Input
                  placeholder="https://..."
                  value={generalForm.logoUrl}
                  onChange={(event) => {
                    setStoreImageFile(null);
                    setGeneralForm((form) => ({ ...form, logoUrl: event.target.value }));
                  }}
                />
              </FormField>
            </div>
          </div>
        </CardContent>
        <CardActions>
          <Button
            className="w-full sm:w-auto"
            disabled={!pinConfirmed || !generalForm.addressLine.trim() || !generalForm.city.trim() || !generalForm.state || generalForm.zipCode.replace(/\D/g, "").length !== 8}
            isLoading={saveGeneral.isPending}
            onClick={() => {
              if (companyPin) saveGeneral.mutate({ point: companyPin });
            }}
          >
            Salvar dados gerais
          </Button>
        </CardActions>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horário de funcionamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">Ative cada dia em que a loja recebe pedidos e defina a abertura e o fechamento. Se fechar depois da meia-noite, informe o horário normalmente.</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {WEEKDAYS.map((day) => {
              const schedule = openingHours[day.key];
              return (
                <div key={day.key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold text-slate-800 dark:text-slate-100">{day.label}</p>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={schedule.isOpen}
                        onChange={(event) => updateOpeningHour(day.key, "isOpen", event.target.checked)}
                      />
                      {schedule.isOpen ? "Aberto" : "Fechado"}
                    </label>
                  </div>
                  {schedule.isOpen ? (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <FormField label="Abre às">
                        <Input
                          type="time"
                          value={schedule.opensAt}
                          onChange={(event) => updateOpeningHour(day.key, "opensAt", event.target.value)}
                        />
                      </FormField>
                      <FormField label="Fecha às">
                        <Input
                          type="time"
                          value={schedule.closesAt}
                          onChange={(event) => updateOpeningHour(day.key, "closesAt", event.target.value)}
                        />
                      </FormField>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">A loja não recebe pedidos neste dia.</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
        <CardActions description="Exemplo: 18:00 até 00:00 indica que o fechamento acontece no dia seguinte.">
          <Button className="w-full sm:w-auto" isLoading={saveOpeningHours.isPending} onClick={() => saveOpeningHours.mutate()}>
            Salvar horário de funcionamento
          </Button>
        </CardActions>
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
        <CardActions>
          <Button className="w-full sm:w-auto" isLoading={savePaymentMethods.isPending} onClick={() => savePaymentMethods.mutate()}>
            Salvar formas de pagamento
          </Button>
        </CardActions>
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
        </CardContent>
        <CardActions>
          <Button className="w-full sm:w-auto" isLoading={saveAiTraining.isPending} onClick={() => saveAiTraining.mutate()}>
            Salvar configurações do agente
          </Button>
        </CardActions>
      </Card>

      {/* Vale para qualquer papel que use o painel, não só o administrador. */}
      <ChangePasswordCard />

      {/*
        Só o caminho do Gupshup aparece para o empresário. A conexão direta pela
        Meta continua no código e nas rotas, para quem já está conectado por lá,
        mas expor as duas obrigaria o dono da loja a escolher entre provedores
        que ele não tem como avaliar.
      */}
      <WhatsAppGupshupSettings />
    </div>
  );
}
