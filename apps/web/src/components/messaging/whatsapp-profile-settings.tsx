"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";

type WhatsAppProfile = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  country?: string | null;
  description?: string | null;
  email?: string | null;
  website1?: string | null;
  website2?: string | null;
  vertical?: string | null;
  profilePictureUrl?: string | null;
  displayName?: string | null;
  number?: string | null;
};

/** Rótulos das verticais aceitas pela Meta, na ordem que faz sentido no Brasil. */
const VERTICALS: Array<{ value: string; label: string }> = [
  { value: "RESTAURANT", label: "Restaurante e alimentação" },
  { value: "RETAIL", label: "Varejo" },
  { value: "GROCERY", label: "Mercado e hortifruti" },
  { value: "APPAREL", label: "Moda e vestuário" },
  { value: "BEAUTY", label: "Beleza e estética" },
  { value: "HEALTH", label: "Saúde" },
  { value: "PROF_SERVICES", label: "Serviços profissionais" },
  { value: "FINANCE", label: "Finanças" },
  { value: "EDU", label: "Educação" },
  { value: "TRAVEL", label: "Viagem e turismo" },
  { value: "HOTEL", label: "Hotelaria" },
  { value: "AUTO", label: "Automotivo" },
  { value: "ENTERTAIN", label: "Entretenimento" },
  { value: "EVENT_PLAN", label: "Eventos" },
  { value: "NONPROFIT", label: "Organização sem fins lucrativos" },
  { value: "GOVT", label: "Governo" },
  { value: "OTHER", label: "Outro" },
];

const EMPTY_FORM = {
  description: "",
  // O endereço é estruturado no perfil do WhatsApp. Um campo de texto único
  // fazia o provedor descartar tudo em silêncio.
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  pinCode: "",
  country: "Brasil",
  email: "",
  website1: "",
  website2: "",
  vertical: "",
};

/**
 * Perfil que o cliente final vê no WhatsApp. Ele pode ser gerido pelo provedor
 * tanto no canal exclusivo quanto na coexistência; fica junto da Central porque
 * é uma configuração operacional do atendimento, não técnica.
 */
export function WhatsAppProfileSettings({
  basePath = "/messaging/channel/whatsapp",
  title = "Perfil do WhatsApp",
}: {
  /**
   * Empresa e canal institucional expõem o mesmo perfil em rotas distintas, e o
   * formulário é idêntico — só muda de onde os dados vêm.
   */
  basePath?: string;
  title?: string;
} = {}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["whatsapp-profile", basePath],
    queryFn: async () => (await api.get<WhatsAppProfile>(`${basePath}/profile`)).data,
    // O endpoint recusa quando o canal não está conectado por um BSP que
    // gerencie o perfil; nesse caso a seção simplesmente não aparece.
    retry: false,
  });

  useEffect(() => {
    if (!profile) return;
    setForm({
      description: profile.description ?? "",
      addressLine1: profile.addressLine1 ?? "",
      addressLine2: profile.addressLine2 ?? "",
      city: profile.city ?? "",
      state: profile.state ?? "",
      pinCode: profile.pinCode ?? "",
      country: profile.country ?? "Brasil",
      email: profile.email ?? "",
      website1: profile.website1 ?? "",
      website2: profile.website2 ?? "",
      vertical: profile.vertical ?? "",
    });
  }, [profile]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-profile", basePath] });

  const save = useMutation({
    mutationFn: async () => {
      // Campo vazio é omitido: mandar string vazia apagaria informação já
      // aprovada no perfil sem o empresário ter pedido isso.
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, value]) => value.trim().length > 0),
      );
      return (await api.patch<WhatsAppProfile>(`${basePath}/profile`, payload)).data;
    },
    onSuccess: () => {
      setError(null);
      setFeedback("Perfil atualizado. A Meta pode levar alguns minutos para propagar.");
      void refresh();
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return (await api.post<WhatsAppProfile>(`${basePath}/profile/photo`, body)).data;
    },
    onSuccess: () => {
      setError(null);
      setFeedback("Foto do perfil atualizada.");
      void refresh();
    },
    onError: (cause) => {
      setFeedback(null);
      setError(apiErrorMessage(cause));
    },
  });

  const hasContent = Object.values(form).some((value) => value.trim().length > 0);

  if (isError) return null;
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando o perfil do WhatsApp…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          É isto que seu cliente vê ao abrir a conversa
          {profile?.number ? <> no número <strong>{profile.number}</strong></> : null}.
        </p>

        <div className="flex items-center gap-4">
          {profile?.profilePictureUrl ? (
            // Imagem hospedada pela Meta, em domínio que muda por conta; usar
            // next/image exigiria liberar o host no config a cada cliente.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.profilePictureUrl}
              alt="Foto do perfil do WhatsApp"
              className="h-20 w-20 rounded-full border border-slate-200 object-cover dark:border-slate-700"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-600">
              sem foto
            </div>
          )}
          <div className="space-y-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={uploadPhoto.isPending}
            >
              {uploadPhoto.isPending ? "Enviando…" : "Trocar foto"}
            </Button>
            <p className="text-xs text-slate-500 dark:text-slate-400">JPEG ou PNG quadrado, no mínimo 192×192.</p>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadPhoto.mutate(file);
              event.target.value = "";
            }}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Segmento">
            <Select
              value={form.vertical}
              onChange={(event) => setForm((current) => ({ ...current, vertical: event.target.value }))}
            >
              <option value="">Selecione…</option>
              {VERTICALS.map((vertical) => (
                <option key={vertical.value} value={vertical.value}>
                  {vertical.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Endereço">
            <Input
              placeholder="Rua e número"
              value={form.addressLine1}
              onChange={(event) => setForm((current) => ({ ...current, addressLine1: event.target.value }))}
            />
          </FormField>
          <FormField label="Complemento / bairro">
            <Input
              value={form.addressLine2}
              onChange={(event) => setForm((current) => ({ ...current, addressLine2: event.target.value }))}
            />
          </FormField>
          <FormField label="Cidade">
            <Input
              value={form.city}
              onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
            />
          </FormField>
          <FormField label="Estado">
            <Input
              placeholder="GO"
              value={form.state}
              onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))}
            />
          </FormField>
          <FormField label="CEP">
            <Input
              value={form.pinCode}
              onChange={(event) => setForm((current) => ({ ...current, pinCode: event.target.value }))}
            />
          </FormField>
          <FormField label="País">
            <Input
              value={form.country}
              onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
            />
          </FormField>
          <FormField label="Site">
            <Input
              placeholder="https://"
              value={form.website1}
              onChange={(event) => setForm((current) => ({ ...current, website1: event.target.value }))}
            />
          </FormField>
          <FormField label="Site alternativo">
            <Input
              placeholder="https://"
              value={form.website2}
              onChange={(event) => setForm((current) => ({ ...current, website2: event.target.value }))}
            />
          </FormField>
        </div>

        <FormField label="Descrição do negócio">
          <Textarea
            rows={3}
            maxLength={512}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          />
        </FormField>

        {feedback && <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{feedback}</p>}
        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>

      <CardActions description="As mudanças valem para todos os clientes que abrirem a conversa.">
        {/* Salvar com tudo vazio só produziria uma recusa do BSP que parece
            falha de gravação. */}
        <Button
          onClick={() => save.mutate()}
          isLoading={save.isPending}
          disabled={save.isPending || !hasContent}
        >
          Salvar perfil
        </Button>
      </CardActions>
    </Card>
  );
}
