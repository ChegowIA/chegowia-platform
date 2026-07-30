"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { homePathForRole, isBackofficeRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";
import { Company, MarketplaceProduct, MarketplaceResponse, PublicPromotion } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductImage } from "@/components/catalog/product-image";
import { ProductTypeIcon } from "@/components/catalog/product-type-icon";
import { PublicDiscoveryPanel } from "@/components/ai/public-discovery-panel";

export default function HomePage() {
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);

  useEffect(() => {
    if (!hasHydrated || isSessionLoading || !user || !isBackofficeRole(user.role)) return;
    router.replace(homePathForRole(user.role));
  }, [hasHydrated, isSessionLoading, router, user]);

  const { data: companies, isLoading: loadingCompanies } = useQuery({
    queryKey: ["public-companies", search, city],
    queryFn: async () => {
      const { data } = await api.get<Company[]>("/companies/public", { params: { search, city } });
      return data;
    },
  });

  const { data: marketplace, isLoading: loadingMarketplace } = useQuery({
    queryKey: ["public-marketplace", search, city, categoryId],
    queryFn: async () => {
      const { data } = await api.get<MarketplaceResponse>("/catalog/public/marketplace", {
        params: { search: search || undefined, city: city || undefined, categoryId: categoryId || undefined },
      });
      return data;
    },
  });

  const { data: promotions } = useQuery({
    queryKey: ["public-promotions", city],
    queryFn: async () => {
      const { data } = await api.get<PublicPromotion[]>("/promotions/public", { params: { city: city || undefined } });
      return data;
    },
  });

  if (hasHydrated && !isSessionLoading && user && isBackofficeRole(user.role)) return null;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 pb-14">
        <section className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr] lg:items-start">
          <div className="space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-brand-700">ChegowIA marketplace</p>
              <h1 className="mt-2 max-w-2xl text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                Produtos, ofertas e lojas da sua região em uma vitrine inteligente.
              </h1>
              <p className="mt-3 max-w-xl text-base text-slate-600">
                Descubra produtos por categoria, veja ofertas ativas e entre no cardápio das empresas próximas.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Produto, loja ou categoria..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Input placeholder="Cidade..." value={city} onChange={(event) => setCity(event.target.value)} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <Metric value={companies?.length ?? 0} label="lojas" tone="brand" />
                <Metric value={marketplace?.productTypes.length ?? 0} label="categorias" tone="accent" />
                <Metric value={promotions?.length ?? 0} label="ofertas" tone="slate" />
              </div>
            </div>
          </div>

          <PublicDiscoveryPanel />
        </section>

        <section className="mt-10">
          <SectionHeader eyebrow="Tipos de produtos" title="Explore por tipo" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <TypeChip active={!categoryId} onClick={() => setCategoryId("")} name="Tudo" icon="all" />
            {marketplace?.productTypes.map((type) => (
              <TypeChip
                key={type.id}
                active={categoryId === type.id}
                onClick={() => setCategoryId(type.id)}
                name={type.name}
                icon={type.icon}
              />
            ))}
          </div>
        </section>

        {promotions && promotions.length > 0 && (
          <section className="mt-10">
            <SectionHeader
              eyebrow="Ofertas do dia"
              title="Promoções ativas agora"
              subtitle="Ofertas cadastradas pelas empresas e liberadas para a vitrine pública."
            />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {promotions.slice(0, 6).map((promotion) => (
                <OfferCard key={promotion.id} promotion={promotion} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <SectionHeader
            eyebrow="Produtos em destaque"
            title="Boas escolhas para pedir agora"
            subtitle={city ? `Filtrado para ${city}.` : "Produtos destacados pelas empresas no painel."}
          />
          {loadingMarketplace && <LoadingCard label="Carregando produtos..." />}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {marketplace?.featuredProducts.slice(0, 8).map((product) => (
              <HomeProductCard key={product.id} product={product} compact />
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-8">
          {marketplace?.sections.map((section) => (
            <div key={section.categoryId}>
              <div className="mb-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-brand-100 bg-brand-50 text-brand-700">
                    <ProductTypeIcon icon={section.icon} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-700">{section.categoryName}</p>
                    <h2 className="text-2xl font-black text-slate-950">{section.categoryName}</h2>
                    {section.description && <p className="mt-1 text-sm text-slate-500">{section.description}</p>}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {section.products.map((product) => (
                  <HomeProductCard key={product.id} product={product} />
                ))}
              </div>
            </div>
          ))}
          {!loadingMarketplace && marketplace?.sections.length === 0 && (
            <LoadingCard label="Nenhum produto encontrado para os filtros atuais." />
          )}
        </section>

        <section className="mt-10">
          <SectionHeader
            eyebrow="Empresas perto de mim"
            title="Lojas para conhecer"
            subtitle={
              city
                ? `Empresas ativas encontradas para ${city}.`
                : "Informe uma cidade no filtro para aproximar a listagem da sua região."
            }
          />
          {loadingCompanies && <LoadingCard label="Carregando lojas..." />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {companies?.map((company) => (
              <CompanyCard key={company.id} company={company} />
            ))}
            {companies?.length === 0 && !loadingCompanies && <LoadingCard label="Nenhuma loja encontrada para os filtros atuais." />}
          </div>
        </section>
      </main>
    </>
  );
}

function Metric({ value, label, tone }: { value: number; label: string; tone: "brand" | "accent" | "slate" }) {
  const classes = {
    brand: "bg-brand-50 text-brand-800",
    accent: "bg-accent-50 text-accent-800",
    slate: "bg-slate-100 text-slate-800",
  };
  return (
    <div className={`rounded-lg px-3 py-3 ${classes[tone]}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide opacity-75">{label}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-brand-700">{eyebrow}</p>
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function TypeChip({
  name,
  icon,
  active,
  onClick,
}: {
  name: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group min-h-[104px] rounded-lg border p-3 text-left transition ${
        active
          ? "border-brand-200 bg-brand-600 text-white shadow-lift"
          : "border-slate-200 bg-white text-slate-700 shadow-soft hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800"
      }`}
    >
      <span
        className={`mb-3 grid h-10 w-10 place-items-center rounded-lg border ${
          active
            ? "border-white/25 bg-white/15 text-white"
            : "border-brand-100 bg-brand-50 text-brand-700 group-hover:border-brand-200"
        }`}
      >
        <ProductTypeIcon icon={icon} />
      </span>
      <p className="text-sm font-black leading-tight">{name}</p>
    </button>
  );
}

function OfferCard({ promotion }: { promotion: PublicPromotion }) {
  const discount =
    promotion.discountType === "PERCENTUAL" ? `${Number(promotion.discountValue)}% OFF` : `${formatCurrency(Number(promotion.discountValue))} OFF`;

  return (
    <Link
      href={`/loja/${promotion.company.slug}`}
      className="group overflow-hidden rounded-lg border border-brand-200 bg-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="bg-gradient-to-r from-brand-600 to-accent-700 px-4 py-4 text-white">
        <p className="text-xs font-bold uppercase tracking-wide text-white/75">Oferta ativa</p>
        <p className="mt-1 text-3xl font-black">{discount}</p>
      </div>
      <div className="p-4">
        <div className="flex gap-3">
          <ProductImage src={promotion.company.logoUrl} alt={promotion.company.name} className="h-14 w-14 shrink-0" />
          <div className="min-w-0">
            <h3 className="line-clamp-1 font-black text-slate-950 group-hover:text-brand-700">{promotion.title}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{promotion.description || promotion.company.name}</p>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              {promotion.company.name} · {promotion.company.avgDeliveryTimeMinutes} min
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function HomeProductCard({ product, compact = false }: { product: MarketplaceProduct; compact?: boolean }) {
  return (
    <Link
      href={`/loja/${product.company.slug}`}
      className="group rounded-lg border border-slate-200 bg-white p-3 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
    >
      <ProductImage src={product.imageUrl} alt={product.name} className={compact ? "h-32 w-full" : "h-36 w-full"} />
      <div className="pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-800">
            {product.publicType.name}
          </span>
          {product.isFeatured && <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-bold text-accent-800">Destaque</span>}
        </div>
        <h3 className="line-clamp-2 min-h-10 font-black text-slate-950 group-hover:text-brand-700">{product.name}</h3>
        {product.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{product.description}</p>}
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-lg font-black text-brand-700">{formatCurrency(Number(product.price))}</p>
            <p className="line-clamp-1 text-xs text-slate-400">{product.company.name}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
            {product.company.avgDeliveryTimeMinutes} min
          </span>
        </div>
      </div>
    </Link>
  );
}

function CompanyCard({ company }: { company: Company }) {
  return (
    <Link
      href={`/loja/${company.slug}`}
      className="group rounded-lg border border-slate-200 bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
    >
      <div className="flex items-start gap-3">
        <ProductImage src={company.logoUrl} alt={company.name} className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-lg font-bold text-slate-950 group-hover:text-brand-700">{company.name}</h3>
          <p className="text-sm text-slate-500">
            {company.city}
            {company.state ? ` - ${company.state}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
              {formatCurrency(company.deliveryFeeBase)}
            </span>
            <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-800">
              {company.avgDeliveryTimeMinutes} min
            </span>
          </div>
          {company.deliveryAreas?.length ? (
            <p className="mt-3 line-clamp-1 text-xs text-slate-400">
              Atende: {company.deliveryAreas.map((area) => area.neighborhood).join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-white p-5 text-center text-sm font-medium text-slate-500 shadow-soft">
      {label}
    </p>
  );
}
