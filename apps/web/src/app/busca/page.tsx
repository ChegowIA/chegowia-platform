"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import gsap from "gsap";
import { Role } from "@chegowia/shared";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Address, PublicSearchResponse } from "@/lib/types";
import { PublicHeader } from "@/components/layout/public-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarketplaceCompanyCard, MarketplaceProductCard } from "@/components/catalog/marketplace-cards";

export default function BuscaPage() {
  return (
    <>
      <PublicHeader />
      <Suspense fallback={<main className="mx-auto max-w-6xl px-4 py-10" />}>
        <SearchResults />
      </Suspense>
    </>
  );
}

function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const page = Math.max(1, Number(params.get("pagina") ?? 1) || 1);

  const [draft, setDraft] = useState(query);
  const user = useAuthStore((state) => state.user);
  const isCustomer = user?.role === Role.CLIENTE;

  const resultsRef = useRef<HTMLDivElement | null>(null);

  const { data: addresses } = useQuery({
    queryKey: ["my-addresses"],
    queryFn: async () => (await api.get<Address[]>("/addresses")).data,
    enabled: isCustomer,
  });
  const location = addresses?.find((address) => address.isDefault) ?? addresses?.[0];
  const city = location?.city;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["public-search", query, location?.city, location?.state, location?.zipCode, page],
    queryFn: async () =>
      (
        await api.get<PublicSearchResponse>("/catalog/public/search", {
          params: { query, city, state: location?.state, zipCode: location?.zipCode, page },
        })
      ).data,
    enabled: query.length >= 2,
  });

  useEffect(() => setDraft(query), [query]);

  // Entrada em cascata dos resultados, no mesmo espírito da animação de /acesso.
  useLayoutEffect(() => {
    if (!resultsRef.current || isLoading) return;
    const cards = resultsRef.current.querySelectorAll("[data-result-card]");
    if (!cards.length) return;
    gsap.fromTo(
      cards,
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: .42, stagger: .035, ease: "power3.out", overwrite: true },
    );
  }, [isLoading, data]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const term = draft.trim();
    if (term.length < 2) return;
    router.push(`/busca?q=${encodeURIComponent(term)}`);
  }

  const products = data?.products;
  const companies = data?.companies ?? [];
  const interpretation = data?.interpretation;
  const extraTerms = interpretation
    ? interpretation.terms.filter((term) => !interpretation.query.toLowerCase().includes(term))
    : [];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:pt-8">
      <div className="sticky top-2 z-20 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-lg backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
        <form onSubmit={submit} className="flex items-center gap-2">
          <Link
            href="/"
            aria-label="Voltar para a página inicial"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:-translate-y-0.5 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-brand-800 dark:hover:bg-brand-950/40 dark:hover:text-brand-300"
          >
            ←
          </Link>
          <Input
            className="h-12 flex-1 border-0 bg-slate-50 px-4 shadow-none focus:ring-brand-300 dark:bg-slate-800/60"
            placeholder="Busque por prato, loja ou categoria"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
          <Button type="submit" className="h-12 shrink-0 px-5">
            Buscar
          </Button>
        </form>
      </div>

      {query.length < 2 ? (
        <EmptyState
          title="O que você está com vontade de comer?"
          text="Digite um prato, um ingrediente ou o nome de uma loja. Não precisa acertar o nome exato."
        />
      ) : isLoading ? (
        <p className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Entendendo sua busca...
        </p>
      ) : isError ? (
        <EmptyState title="Não consegui buscar agora" text={(error as Error)?.message ?? "Tente novamente em instantes."} />
      ) : (
        <>
          {interpretation && (
            <section className="mt-6 rounded-2xl border border-brand-100 bg-brand-50 p-4 dark:border-brand-900/50 dark:bg-brand-950/30">
              <p className="text-[10px] font-black uppercase tracking-[.18em] text-brand-700 dark:text-brand-300">
                {interpretation.assisted ? "Busca inteligente" : "Busca por termos parecidos"}
              </p>
              <p className="mt-1.5 text-sm font-bold text-brand-900 dark:text-brand-200">{interpretation.explanation}</p>
              {extraTerms.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-brand-800/80 dark:text-brand-300/80">
                    Além de <strong>{interpretation.query}</strong>, também procurei por:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {extraTerms.slice(0, 10).map((term) => (
                      <span
                        key={term}
                        className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand-800 dark:bg-slate-900 dark:text-brand-300"
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <div ref={resultsRef}>
            {companies.length > 0 && (
              <section className="mt-8">
                <SectionTitle title="Lojas" count={companies.length} />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {companies.map((company) => (
                    <div key={company.id} data-result-card>
                      <MarketplaceCompanyCard company={company} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-8">
              <SectionTitle title="Produtos" count={products?.total ?? 0} />
              {products && products.items.length > 0 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {products.items.map((product) => (
                      <div key={product.id} data-result-card>
                        <MarketplaceProductCard product={product} compact />
                      </div>
                    ))}
                  </div>
                  {products.totalPages > 1 && (
                    <Pagination
                      page={products.page}
                      totalPages={products.totalPages}
                      onGo={(next) => router.push(`/busca?q=${encodeURIComponent(query)}&pagina=${next}`)}
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  title={`Nada encontrado para "${query}"`}
                  text="Tente descrever de outro jeito — por ingrediente, tipo de prato ou nome da loja."
                />
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-4 flex items-baseline gap-2">
      <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">{title}</h2>
      <span className="text-sm font-semibold text-slate-400 dark:text-slate-500">{count}</span>
    </div>
  );
}

function Pagination({ page, totalPages, onGo }: { page: number; totalPages: number; onGo: (page: number) => void }) {
  return (
    <div className="mt-8 flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onGo(page - 1)}>
        Anterior
      </Button>
      <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
        {page} de {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onGo(page + 1)}>
        Próxima
      </Button>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-8 rounded-[28px] border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-lg font-black text-slate-800 dark:text-slate-200">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );
}
