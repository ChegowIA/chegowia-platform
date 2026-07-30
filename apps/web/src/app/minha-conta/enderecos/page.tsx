"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Address } from "@/lib/types";
import { PublicHeader } from "@/components/layout/public-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

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
    setError(null);
    setModalOpen(true);
  }

  const saveAddress = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        label: form.label || undefined,
        complement: form.complement || undefined,
        zipCode: form.zipCode || undefined,
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

        {isLoading && <p className="text-slate-500">Carregando...</p>}
        {!isLoading && addresses?.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-slate-500">Nenhum endereço cadastrado.</CardContent>
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
                  </p>
                  <p className="text-sm text-slate-500">
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Editar endereço" : "Novo endereço"}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Apelido (opcional)">
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </FormField>
            <FormField label="Rua">
              <Input required value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
            </FormField>
            <FormField label="Número">
              <Input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </FormField>
            <FormField label="Complemento">
              <Input value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} />
            </FormField>
            <FormField label="Bairro">
              <Input required value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
            </FormField>
            <FormField label="Cidade">
              <Input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </FormField>
            <FormField label="Estado (UF)">
              <Input
                required
                maxLength={2}
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField label="CEP">
              <Input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} />
            </FormField>
          </div>
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button isLoading={saveAddress.isPending} onClick={() => saveAddress.mutate()}>
              Salvar
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
