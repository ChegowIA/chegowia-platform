"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PaymentMethod, Role } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { homePathForRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";
import { cartSubtotal, useCartStore } from "@/lib/cart-store";
import { Address, DeliveryQuote, Order } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.DINHEIRO]: "Dinheiro",
  [PaymentMethod.CARTAO_ENTREGA]: "Cartão na entrega",
  [PaymentMethod.PIX_MANUAL]: "Pix",
};

export default function CheckoutPage() {
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isSessionLoading = useAuthStore((s) => s.isSessionLoading);

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-50">Checkout</h1>
        {!hasHydrated || isSessionLoading ? (
          <LoadingNotice />
        ) : !user ? (
          <LoginRequiredNotice />
        ) : user.role !== Role.CLIENTE ? (
          <CustomerOnlyNotice role={user.role} />
        ) : (
          <CheckoutForm />
        )}
      </main>
    </>
  );
}

function LoadingNotice() {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <p className="text-slate-500 dark:text-slate-400">Validando sua sessão...</p>
      </CardContent>
    </Card>
  );
}

function LoginRequiredNotice() {
  return (
    <Card>
      <CardContent className="space-y-4 py-8 text-center">
        <p className="text-slate-600 dark:text-slate-300">
          Você precisa entrar ou criar uma conta para finalizar o pedido. Seu carrinho continua salvo.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/acesso">
            <Button variant="outline">Entrar</Button>
          </Link>
          <Link href="/acesso?modo=cadastro">
            <Button>Criar conta</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerOnlyNotice({ role }: { role: Role }) {
  return (
    <Card>
      <CardContent className="space-y-4 py-8 text-center">
        <p className="text-slate-600 dark:text-slate-300">
          Checkout é exclusivo para conta de cliente. Você já está logado em uma conta interna.
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row"><Link href="/acesso?trocar-conta=cliente"><Button>Entrar como cliente</Button></Link><Link href="/acesso?trocar-conta=cliente&modo=cadastro"><Button variant="outline">Criar conta cliente</Button></Link><Link href={homePathForRole(role)}><Button variant="ghost">Ir para o painel</Button></Link></div>
      </CardContent>
    </Card>
  );
}

function CheckoutForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const items = useCartStore((s) => s.items);
  const companySlug = useCartStore((s) => s.companySlug);
  const clearCart = useCartStore((s) => s.clear);
  const subtotal = cartSubtotal(items);

  const [addressId, setAddressId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.DINHEIRO);
  const [notes, setNotes] = useState("");
  const [whatsappNotificationsAccepted, setWhatsappNotificationsAccepted] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: addresses, isLoading: loadingAddresses } = useQuery({
    queryKey: ["my-addresses"],
    queryFn: async () => {
      const { data } = await api.get<Address[]>("/addresses");
      return data;
    },
  });

  useEffect(() => {
    if (!addressId && addresses && addresses.length > 0) {
      const def = addresses.find((a) => a.isDefault) ?? addresses[0];
      setAddressId(def.id);
    }
  }, [addresses, addressId]);

  const deliveryQuote = useQuery({
    queryKey: ["delivery-quote", companySlug, addressId],
    enabled: Boolean(companySlug && addressId),
    retry: false,
    staleTime: 5 * 60 * 1_000,
    queryFn: async () => {
      const { data } = await api.post<DeliveryQuote>("/me/orders/quote", { companySlug, addressId });
      return data;
    },
  });

  const createOrder = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Order>("/me/orders", {
        companySlug,
        addressId,
        paymentMethod,
        notes: notes || undefined,
        whatsappNotificationsAccepted: Boolean(deliveryQuote.data?.whatsappNotificationsAvailable && whatsappNotificationsAccepted),
        whatsappPhone: whatsappNotificationsAccepted ? whatsappPhone : undefined,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          variationId: i.variationId,
          addonIds: i.addonIds,
          optionSelections: i.optionSelections,
          notes: i.notes,
        })),
      });
      return data;
    },
    onSuccess: (order) => {
      clearCart();
      router.push(`/pedido/${order.id}`);
    },
  });

  function handleConfirm() {
    setFormError(null);
    if (!addressId) {
      setFormError("Selecione ou cadastre um endereço de entrega.");
      return;
    }
    if (deliveryQuote.data?.whatsappNotificationsAvailable && whatsappNotificationsAccepted) {
      const phone = whatsappPhone.replace(/\D/g, "");
      if (phone.length !== 11 || phone[2] !== "9") {
        setFormError("Informe um celular com DDD para receber os avisos pelo WhatsApp.");
        return;
      }
    }
    createOrder.mutate();
  }

  if (items.length === 0 || !companySlug) {
    return (
      <Card>
        <CardContent className="space-y-4 py-8 text-center">
          <p className="text-slate-500 dark:text-slate-400">Seu carrinho está vazio.</p>
          <Link href="/" className="font-medium text-brand-600 hover:underline">
            Voltar para a home
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Endereço de entrega</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingAddresses && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando endereços...</p>}
          {addresses?.map((addr) => (
            <label
              key={addr.id}
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"
            >
              <input
                type="radio"
                name="address"
                className="mt-1"
                checked={addressId === addr.id}
                onChange={() => setAddressId(addr.id)}
              />
              <span>
                <span className="block font-medium text-slate-900 dark:text-slate-100">
                  {addr.label ? `${addr.label} — ` : ""}
                  {addr.street}, {addr.number}
                  {addr.isDefault && <span className="ml-2 text-xs font-normal text-brand-600">(padrão)</span>}
                </span>
                <span className="block text-slate-500 dark:text-slate-400">
                  {addr.neighborhood}, {addr.city} - {addr.state}
                  {addr.complement ? ` · ${addr.complement}` : ""}
                </span>
              </span>
            </label>
          ))}
          {!loadingAddresses && addresses?.length === 0 && !showAddressForm && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Você ainda não tem endereços cadastrados.</p>
          )}
          {!showAddressForm && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAddressForm(true)}>
              + Cadastrar novo endereço
            </Button>
          )}
          {showAddressForm && (
            <NewAddressForm
              onCreated={(addr) => {
                queryClient.setQueryData<Address[]>(["my-addresses"], (old) => [...(old ?? []), addr]);
                setAddressId(addr.id);
                setShowAddressForm(false);
              }}
              onCancel={() => setShowAddressForm(false)}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forma de pagamento</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {Object.values(PaymentMethod).map((pm) => (
              <option key={pm} value={pm}>
                {PAYMENT_LABELS[pm]}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      {deliveryQuote.data?.whatsappNotificationsAvailable && (
        <Card>
            <CardHeader><CardTitle>Acompanhar pelo WhatsApp</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
                <input type="checkbox" className="mt-1 size-4 accent-emerald-600" checked={whatsappNotificationsAccepted} onChange={(event) => setWhatsappNotificationsAccepted(event.target.checked)} />
                <span><strong className="block">Quero receber atualizações deste pedido</strong><span className="mt-1 block text-xs leading-5">A loja enviará avisos de andamento para o número abaixo. É opcional e não inclui ofertas.</span></span>
              </label>
              {whatsappNotificationsAccepted && (
                <FormField label="Seu celular com WhatsApp e DDD">
                  <MaskedInput mask="phone" type="tel" autoComplete="tel-national" placeholder="(62) 99999-9999" value={whatsappPhone} onChange={(event) => setWhatsappPhone(event.target.value)} />
                </FormField>
              )}
            </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Observações</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: tocar campainha" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resumo do pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((item) => (
            <div key={item.key} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 text-slate-600 dark:text-slate-300">
                <span className="block">{item.quantity}x {item.name}</span>
                {item.optionSelectionsLabel && <span className="mt-0.5 block text-xs text-slate-400">{item.optionSelectionsLabel}</span>}
              </span>
              <span className="text-slate-900 dark:text-slate-100">{formatCurrency(item.unitPrice * item.quantity)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
            <span className="text-slate-600 dark:text-slate-300">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>Rota de entrega</span>
            <span>
              {deliveryQuote.isLoading
                ? "calculando..."
                : deliveryQuote.data
                  ? `${deliveryQuote.data.distanceKm.toFixed(2)} km · ~${deliveryQuote.data.durationMinutes} min`
                  : "aguardando endereço"}
            </span>
          </div>
          <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>Taxa de entrega</span>
            <span>
              {deliveryQuote.data
                ? formatCurrency(deliveryQuote.data.deliveryFee)
                : "calculada pela rota"}
            </span>
          </div>
        </CardContent>
      </Card>

      {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
      {deliveryQuote.isError && <p className="text-sm text-red-600 dark:text-red-400">{apiErrorMessage(deliveryQuote.error)}</p>}
      {createOrder.isError && <p className="text-sm text-red-600 dark:text-red-400">{apiErrorMessage(createOrder.error)}</p>}

      <Button
        type="button"
        className="w-full"
        size="lg"
        isLoading={createOrder.isPending}
        disabled={deliveryQuote.isLoading || deliveryQuote.isError}
        onClick={handleConfirm}
      >
        Confirmar pedido
      </Button>
    </div>
  );
}

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
}

const EMPTY_ADDRESS_FORM: AddressFormState = {
  label: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  zipCode: "",
  reference: "",
};

function NewAddressForm({ onCreated, onCancel }: { onCreated: (addr: Address) => void; onCancel: () => void }) {
  const [form, setForm] = useState<AddressFormState>(EMPTY_ADDRESS_FORM);
  const [error, setError] = useState<string | null>(null);

  const createAddress = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Address>("/addresses", {
        ...form,
        label: form.label || undefined,
        complement: form.complement || undefined,
        zipCode: form.zipCode || undefined,
        reference: form.reference || undefined,
      });
      return data;
    },
    onSuccess: onCreated,
    onError: (err) => setError(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
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
          <BrazilStateSelect required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        </FormField>
        <FormField label="CEP">
          <MaskedInput mask="cep" placeholder="00000-000" value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} />
        </FormField>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" isLoading={createAddress.isPending} onClick={() => createAddress.mutate()}>
          Salvar endereço
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
