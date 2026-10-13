"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Address } from "@/lib/types";
import { PublicHeader } from "@/components/layout/public-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";
import { Modal } from "@/components/ui/modal";
import { DeliveryPin, DeliveryPinPicker } from "@/components/deliveries/delivery-pin-picker";

interface AddressFormState {
  label: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  reference: string;
  isDefault: boolean;
}

const EMPTY_FORM: AddressFormState = {
  label: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  zipCode: "",
  reference: "",
  isDefault: false,
};

export default function AddressesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);
  const [form, setForm] = useState<AddressFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<DeliveryPin | null>(null);
  const [pinConfirmed, setPinConfirmed] = useState(false);

  const { data: addresses, isLoading } = useQuery({
    queryKey: ["my-addresses"],
    queryFn: async () => {
      const { data } = await api.get<Address[]>("/addresses");
      return data;
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPin(null);
    setPinConfirmed(false);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(addr: Address) {
    setEditing(addr);
    setForm({
      label: addr.label ?? "",
      street: addr.street,
      number: addr.number,
      complement: addr.complement ?? "",
      neighborhood: addr.neighborhood,
      city: addr.city,
      state: addr.state,
      zipCode: addr.zipCode ?? "",
      reference: addr.reference ?? "",
      isDefault: addr.isDefault,
    });
    setPin(addr.latitude != null && addr.longitude != null
      ? { latitude: Number(addr.latitude), longitude: Number(addr.longitude) }
      : null);
    setPinConfirmed(Boolean(addr.locationConfirmedAt));
    setError(null);
    setModalOpen(true);
  }

  function changeAddress(field: keyof AddressFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setPin(null);
    setPinConfirmed(false);
  }

  const saveAddress = useMutation({
    mutationFn: async () => {
      if (!pin || !pinConfirmed) throw new Error("Confirme o ponto no mapa antes de salvar.");
      const payload = {
        ...form,
        latitude: pin.latitude,
        longitude: pin.longitude,
        label: form.label || undefined,
        complement: form.complement || undefined,
        zipCode: form.zipCode,
        reference: form.reference || undefined,
      };
      if (editing) {
        const { data } = await api.patch<Address>(`/addresses/${editing.id}`, payload);
        return data;
      }
      const { data } = await api.post<Address>("/addresses", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-addresses"] });
      setModalOpen(false);
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const deleteAddress = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/addresses/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-addresses"] }),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/addresses/${id}`, { isDefault: true });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-addresses"] }),
  });

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Meus endereços</h1>
          <Button size="sm" onClick={openCreate}>
            + Novo endereço
          </Button>
        </div>

        {isLoading && <p className="text-slate-500 dark:text-slate-400">Carregando...</p>}
        {!isLoading && addresses?.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-slate-500 dark:text-slate-400">Nenhum endereço cadastrado.</CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {addresses?.map((addr) => (
            <Card key={addr.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {addr.label ? `${addr.label} — ` : ""}
                    {addr.street}, {addr.number}
                    {addr.isDefault && <span className="ml-2 text-xs font-normal text-brand-600">(padrão)</span>}
                    {!addr.locationConfirmedAt && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Confirmar no mapa</span>}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {addr.neighborhood}, {addr.city} - {addr.state}
                    {addr.complement ? ` · ${addr.complement}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!addr.isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={setDefault.isPending && setDefault.variables === addr.id}
                      onClick={() => setDefault.mutate(addr.id)}
                    >
                      Tornar padrão
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openEdit(addr)}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    isLoading={deleteAddress.isPending && deleteAddress.variables === addr.id}
                    onClick={() => deleteAddress.mutate(addr.id)}
                  >
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar endereço" : "Novo endereço"}
        footer={(
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button className="w-full sm:w-auto" disabled={!pinConfirmed || form.zipCode.replace(/\D/g, "").length !== 8} isLoading={saveAddress.isPending} onClick={() => saveAddress.mutate()}>
              Salvar endereço
            </Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Apelido (opcional)">
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </FormField>
            <FormField label="Rua">
              <Input required value={form.street} onChange={(e) => changeAddress("street", e.target.value)} />
            </FormField>
            <FormField label="Número">
              <Input required value={form.number} onChange={(e) => changeAddress("number", e.target.value)} />
            </FormField>
            <FormField label="Complemento">
              <Input value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} />
            </FormField>
            <FormField label="Bairro">
              <Input required value={form.neighborhood} onChange={(e) => changeAddress("neighborhood", e.target.value)} />
            </FormField>
            <FormField label="Cidade">
              <Input required value={form.city} onChange={(e) => changeAddress("city", e.target.value)} />
            </FormField>
            <FormField label="Estado (UF)">
              <BrazilStateSelect required value={form.state} onChange={(e) => changeAddress("state", e.target.value)} />
            </FormField>
            <FormField label="CEP">
              <MaskedInput mask="cep" placeholder="00000-000" required value={form.zipCode} onChange={(e) => changeAddress("zipCode", e.target.value)} />
            </FormField>
          </div>
          <DeliveryPinPicker
            lookup={{ addressLine: `${form.street}, ${form.number}`, streetName: form.street, neighborhood: form.neighborhood, city: form.city, state: form.state, zipCode: form.zipCode }}
            point={pin}
            confirmed={pinConfirmed}
            onPointChange={(next) => { setPin(next); setPinConfirmed(false); }}
            onConfirm={() => setPinConfirmed(true)}
          />
          <FormField label="Referência">
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </FormField>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            Definir como endereço padrão
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
