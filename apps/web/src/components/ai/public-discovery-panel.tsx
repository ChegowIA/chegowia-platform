"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";
import { PublicDiscoveryProduct, PublicDiscoveryResponse } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ProductImage } from "@/components/catalog/product-image";
import { FloatingAssistantChat } from "@/components/ai/floating-assistant-chat";

const PRESETS = ["Quero um lanche caprichado", "Sugira algo para o almoço", "Quero uma sobremesa"];

export function PublicDiscoveryPanel({ city, state, zipCode, neighborhood }: { city: string; state: string; zipCode: string; neighborhood: string }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<PublicDiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageTouched, setMessageTouched] = useState(false);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const cartCompanySlug = useCartStore((state) => state.companySlug);
  const setCartCompany = useCartStore((state) => state.setCompany);
  const addCartItem = useCartStore((state) => state.addItem);

  const messageIsValid = message.trim().length >= 2;
  const messageError = messageTouched && !messageIsValid ? "Descreva o que você quer encontrar." : null;

  const search = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<PublicDiscoveryResponse>("/ai/public-discovery/search", {
        message,
        city,
        state,
        zipCode,
        neighborhood,
      });
      return data;
    },
    onSuccess: (data) => {
      setError(null);
      setMessageTouched(false);
      setCartFeedback(null);
      setAddedProductId(null);
      setResult(data);
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function handleSearch() {
    setMessageTouched(true);
    if (!messageIsValid) return;
    search.mutate();
  }

  function addToCart(product: PublicDiscoveryProduct) {
    const replacedOtherStore = Boolean(cartCompanySlug && cartCompanySlug !== product.company.slug);
    setCartCompany(product.company.slug);
    addCartItem({
      key: [product.id, "", ""].join("::"),
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.price),
      quantity: 1,
    });
    setAddedProductId(product.id);
    setCartFeedback(
      replacedOtherStore
        ? `O carrinho foi atualizado para a loja ${product.company.name}.`
        : `${product.name} foi adicionado ao carrinho.`,
    );
  }

  return (
    <FloatingAssistantChat
      title="Seu assistente de compras"
      subtitle="Conte o que deu vontade. Eu encontro para você."
      triggerEyebrow="Busca com IA"
      triggerLabel="Peça uma sugestão"
    >
    <section className="h-full overflow-y-auto bg-slate-50/70 p-4 dark:bg-slate-800/50">
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Busca inteligente</p>
          <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-slate-100">O que você gostaria de pedir?</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Pode falar do seu jeito. Eu procuro produtos e lojas na sua região.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <Textarea
            rows={3}
            className="min-h-[92px] resize-none rounded-2xl border-brand-100 bg-brand-50/40 text-base shadow-none focus:bg-white dark:bg-slate-800/60 dark:focus:bg-slate-800 dark:border-brand-900/50"
            placeholder="Ex: quero um hambúrguer caprichado que chegue rápido..."
            value={message}
            onBlur={() => setMessageTouched(true)}
            onChange={(event) => setMessage(event.target.value)}
          />
          {messageError && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{messageError}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-2 pl-3 dark:bg-slate-800/60">
          <p className="min-w-0 truncate text-xs font-bold text-slate-500 dark:text-slate-400">📍 Buscando perto de {neighborhood}, {city}</p>
          <Button className="shrink-0 rounded-xl" isLoading={search.isPending} onClick={handleSearch}>
            Encontrar opções
          </Button>
        </div>
      </div>

      {!result && (
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setMessage(preset)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800/60 dark:border-slate-800 dark:text-slate-400"
            >
              {preset}
            </button>
          ))}
        </div>
      )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
      {cartFeedback && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900/60 dark:text-emerald-300">
          <span>{cartFeedback}</span>
          <Link href="/carrinho" className="shrink-0 font-black text-emerald-700 hover:underline dark:text-emerald-300">Ver carrinho</Link>
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 dark:bg-brand-950/30 dark:border-brand-900/50">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-200">{result.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.suggestions.map((suggestion) => (
                <span key={suggestion} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                  {suggestion}
                </span>
              ))}
            </div>
          </div>

          {result.products.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Produtos encontrados</h3>
              <div className="grid gap-3">
                {result.products.slice(0, 6).map((product) => (
                  <article
                    key={product.id}
                    className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-brand-200 hover:shadow-soft dark:bg-slate-900 dark:border-slate-800"
                  >
                    <div className="flex gap-3">
                      <Link href={`/loja/${product.company.slug}`} className="flex min-w-0 flex-1 gap-3">
                        <ProductImage src={product.imageUrl} alt={product.name} className="h-20 w-20 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 font-semibold text-slate-950 group-hover:text-brand-700 dark:text-slate-100">
                            {product.name}
                          </p>
                          <p className="mt-1 text-sm font-bold text-brand-700 dark:text-brand-300">{formatCurrency(Number(product.price))}</p>
                          <p className="mt-1 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">{product.company.name}</p>
                          <p className="text-xs text-slate-400">
                            {product.company.city}
                            {product.company.state ? ` - ${product.company.state}` : ""}
                          </p>
                        </div>
                      </Link>
                      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                        <Button
                          size="sm"
                          className="rounded-xl px-3"
                          onClick={() => addToCart(product)}
                        >
                          {addedProductId === product.id ? "Adicionado" : "Adicionar"}
                        </Button>
                        <Link href={`/loja/${product.company.slug}`} className="text-[11px] font-bold text-brand-700 hover:underline dark:text-brand-300">
                          Ver loja
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {result.companies.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Lojas próximas</h3>
              <div className="grid gap-3">
                {result.companies.slice(0, 4).map((company) => (
                  <Link
                    key={company.id}
                    href={`/loja/${company.slug}`}
                    className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-200 hover:shadow-soft dark:bg-slate-900 dark:border-slate-800"
                  >
                    <div className="flex items-start gap-3">
                      <ProductImage src={company.logoUrl} alt={company.name} className="h-14 w-14 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-950 dark:text-slate-100">{company.name}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {company.city}
                          {company.state ? ` - ${company.state}` : ""} · {company.avgDeliveryTimeMinutes} min
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Entrega a partir de {formatCurrency(Number(company.deliveryFeeBase))}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
    </FloatingAssistantChat>
  );
}
