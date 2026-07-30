"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { PublicDiscoveryResponse } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ProductImage } from "@/components/catalog/product-image";

const PRESETS = ["Quero pizza perto do Centro", "Marmita no almoço em Campinas", "Sobremesa para entregar hoje"];

export function PublicDiscoveryPanel() {
  const [message, setMessage] = useState("");
  const [city, setCity] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [result, setResult] = useState<PublicDiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageTouched, setMessageTouched] = useState(false);

  const messageIsValid = message.trim().length >= 2;
  const messageError = messageTouched && !messageIsValid ? "Descreva o que você quer encontrar." : null;

  const search = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<PublicDiscoveryResponse>("/ai/public-discovery/search", {
        message,
        city: city || undefined,
        neighborhood: neighborhood || undefined,
      });
      return data;
    },
    onSuccess: (data) => {
      setError(null);
      setMessageTouched(false);
      setResult(data);
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function handleSearch() {
    setMessageTouched(true);
    if (!messageIsValid) return;
    search.mutate();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Assistente de compras</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">Encontre produtos e lojas por região</h2>
          <p className="mt-1 text-sm text-slate-500">
            Consulte a base pública por produto, cidade, bairro, loja ou categoria.
          </p>
        </div>
        <span className="hidden rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-800 sm:inline-flex">
          Base pública
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <Textarea
            rows={3}
            className="min-h-[104px] resize-none border-brand-200 bg-brand-50/40 text-base shadow-inner focus:bg-white"
            placeholder="Ex: quero hambúrguer artesanal perto da Savassi"
            value={message}
            onBlur={() => setMessageTouched(true)}
            onChange={(event) => setMessage(event.target.value)}
          />
          {messageError && <p className="mt-1 text-xs font-medium text-red-600">{messageError}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="Cidade" value={city} onChange={(event) => setCity(event.target.value)} />
          <Input placeholder="Bairro" value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} />
          <Button className="min-w-28" isLoading={search.isPending} onClick={handleSearch}>
            Buscar
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
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
            >
              {preset}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
            <p className="text-sm font-semibold text-brand-900">{result.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.suggestions.map((suggestion) => (
                <span key={suggestion} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                  {suggestion}
                </span>
              ))}
            </div>
          </div>

          {result.products.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Produtos encontrados</h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {result.products.slice(0, 6).map((product) => (
                  <Link
                    key={product.id}
                    href={`/loja/${product.company.slug}`}
                    className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-brand-200 hover:shadow-soft"
                  >
                    <div className="flex gap-3">
                      <ProductImage src={product.imageUrl} alt={product.name} className="h-20 w-20 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 font-semibold text-slate-950 group-hover:text-brand-700">
                          {product.name}
                        </p>
                        <p className="mt-1 text-sm font-bold text-brand-700">{formatCurrency(product.price)}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-slate-500">{product.company.name}</p>
                        <p className="text-xs text-slate-400">
                          {product.company.city}
                          {product.company.state ? ` - ${product.company.state}` : ""}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {result.companies.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Lojas próximas</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {result.companies.slice(0, 4).map((company) => (
                  <Link
                    key={company.id}
                    href={`/loja/${company.slug}`}
                    className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-200 hover:shadow-soft"
                  >
                    <div className="flex items-start gap-3">
                      <ProductImage src={company.logoUrl} alt={company.name} className="h-14 w-14 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-950">{company.name}</p>
                        <p className="text-sm text-slate-500">
                          {company.city}
                          {company.state ? ` - ${company.state}` : ""} · {company.avgDeliveryTimeMinutes} min
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Entrega a partir de {formatCurrency(company.deliveryFeeBase)}
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
  );
}
