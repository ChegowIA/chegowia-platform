"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import { useQuery } from "@tanstack/react-query";
import { Role } from "@chegowia/shared";
import { api } from "@/lib/api-client";
import { homePathForRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";
import { useLogout } from "@/lib/use-auth";
import { Address, Company, MarketplaceResponse, PublicPromotion } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/catalog/product-image";
import { MarketplaceCompanyCard, MarketplaceProductCard } from "@/components/catalog/marketplace-cards";
import { ProductTypeIcon } from "@/components/catalog/product-type-icon";
import { PublicDiscoveryPanel } from "@/components/ai/public-discovery-panel";

export default function HomePage() {
  const router = useRouter();
  const heroRef = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);

  /**
   * O hero recolhe antes de navegar: a transição para /busca fica contínua em
   * vez de um corte seco. Mesmo padrão de timeline com `.call()` usado em
   * /acesso — a navegação acontece no meio da animação.
   */
  function goToSearch(event: React.FormEvent) {
    event.preventDefault();
    const term = search.trim();
    if (term.length < 2) return;
    const href = `/busca?q=${encodeURIComponent(term)}`;
    if (!heroRef.current) {
      router.push(href);
      return;
    }
    gsap.timeline({ defaults: { ease: "power3.inOut" } })
      .to(heroRef.current, { y: -18, scale: .985, opacity: .35, duration: .28 })
      .call(() => router.push(href));
  }

  const isCustomer = user?.role === Role.CLIENTE;
  const isSuperAdmin = user?.role === Role.SUPER_ADMIN;
  const isProfessional = Boolean(user && !isCustomer && !isSuperAdmin);
  const { data: addresses, isLoading: loadingAddress } = useQuery({
    queryKey: ["my-addresses"],
    queryFn: async () => {
      const { data } = await api.get<Address[]>("/addresses");
      return data;
    },
    enabled: isCustomer,
  });
  const location = addresses?.find((address) => address.isDefault) ?? addresses?.[0];
  const hasLocation = Boolean(location && /^\d{5}-?\d{3}$/.test(location.zipCode ?? ""));
  const canBrowseMarketplace = hasLocation || isSuperAdmin;

  const { data: companies, isLoading: loadingCompanies } = useQuery({
    queryKey: ["public-companies", location?.city, location?.state, location?.zipCode],
    queryFn: async () => {
      const { data } = await api.get<Company[]>("/companies/public", { params: { city: location?.city, state: location?.state, zipCode: location?.zipCode } });
      return data;
    },
    enabled: canBrowseMarketplace,
  });

  const { data: marketplace, isLoading: loadingMarketplace } = useQuery({
    queryKey: ["public-marketplace", location?.city, location?.state, location?.zipCode, categoryId],
    queryFn: async () => {
      const { data } = await api.get<MarketplaceResponse>("/catalog/public/marketplace", {
        params: { city: location?.city, state: location?.state, zipCode: location?.zipCode, categoryId: categoryId || undefined },
      });
      return data;
    },
    enabled: canBrowseMarketplace,
  });

  const { data: promotions } = useQuery({
    queryKey: ["public-promotions", location?.city, location?.state, location?.zipCode],
    queryFn: async () => {
      const { data } = await api.get<PublicPromotion[]>("/promotions/public", { params: { city: location?.city, state: location?.state, zipCode: location?.zipCode } });
      return data;
    },
    enabled: canBrowseMarketplace,
  });

  if (hasHydrated && !isSessionLoading && isProfessional && user) {
    return <><PublicHeader /><ProfessionalMarketplaceGate role={user.role} panelHref={homePathForRole(user.role)} onCreateCustomer={async()=>{await logout.mutateAsync();window.location.href="/cadastro"}} /></>;
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:pt-8">
        <section ref={heroRef} className="relative overflow-hidden rounded-[32px] bg-slate-950 px-5 py-10 text-white shadow-[0_28px_80px_-38px_rgba(15,23,42,.7)] sm:px-10 sm:py-14 lg:px-14">
          <div className="pointer-events-none absolute -right-24 -top-40 h-[460px] w-[460px] rounded-full bg-brand-600/30 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-1/3 h-40 w-80 rounded-full bg-accent-500/10 blur-3xl" />
          <div className="relative max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Delivery do seu jeito
              </span>
              <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.03] tracking-tight sm:text-5xl lg:text-6xl">
                Deu vontade? A gente encontra e entrega.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Busque entre lojas, pratos e ofertas perto de você. Rápido para escolher, simples para pedir.
              </p>

            {canBrowseMarketplace ? (
            <>
            <form onSubmit={goToSearch} className="mt-8 flex gap-2 rounded-2xl border border-white/10 bg-white p-2.5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:max-w-2xl">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-slate-400">🔎</span>
                <Input
                  className="h-12 border-0 bg-slate-50 pl-11 pr-4 shadow-none focus:ring-brand-300 dark:bg-slate-800/60"
                  placeholder="Busque por prato, loja ou categoria"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Button type="submit" className="h-12 shrink-0 px-5">Buscar</Button>
            </form>
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-400">
              <span className="text-brand-400">✦</span>
              A busca é interpretada por IA: descreva do seu jeito que encontramos itens parecidos, mesmo com outro nome.
            </p>
            </>
            ) : (
              <LocationGate user={user} loading={loadingAddress || !hasHydrated || isSessionLoading} />
            )}
            {location && hasLocation && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-300">
              <span className="text-brand-400">📍</span>
              <span>Mostrando opções que atendem <strong className="text-white">{location.city}</strong></span>
              <Link href="/minha-conta/enderecos" className="font-bold text-brand-300 hover:text-white">Alterar</Link>
            </div>
            )}
          </div>
        </section>
        {isSuperAdmin && <ReadOnlyCatalogNotice />}

        {!canBrowseMarketplace && hasHydrated && !isSessionLoading && (
          <section className="py-14">
            <div className="mb-7 max-w-xl">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">Feito para ser simples</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-slate-100">Do cadastro até a entrega</h2>
              <p className="mt-2 text-slate-500 dark:text-slate-400">Nada de listas aleatórias. A experiência começa pela sua localização e termina na sua porta.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <HowItWorks number="01" title="Cadastre seu endereço" text="Usamos sua cidade para encontrar apenas estabelecimentos que realmente podem atender você." />
              <HowItWorks number="02" title="Escolha perto de você" text="Pesquise produtos, categorias ou lojas locais sem precisar preencher a cidade toda vez." />
              <HowItWorks number="03" title="Acompanhe ao vivo" text="Depois do pedido, veja cada mudança de status até a entrega chegar." />
            </div>
          </section>
        )}

        {canBrowseMarketplace && (
        <>
        <section className="mt-10">
          <SectionHeader eyebrow="Tipos de produtos" title="Explore por tipo" />
          <div className="flex gap-3 overflow-x-auto pb-3 sm:grid sm:grid-cols-3 lg:grid-cols-6">
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
            subtitle={location ? `Opções disponíveis em ${location.city}.` : "Produtos publicados em toda a plataforma."}
          />
          {loadingMarketplace && <LoadingCard label="Carregando produtos..." />}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {marketplace?.featuredProducts.slice(0, 8).map((product) => (
              <MarketplaceProductCard key={product.id} product={product} compact />
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-8">
          {marketplace?.sections.map((section) => (
            <div key={section.categoryId}>
              <div className="mb-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-brand-100 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:border-brand-900/50 dark:text-brand-300">
                    <ProductTypeIcon icon={section.icon} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">{section.categoryName}</p>
                    <h2 className="text-2xl font-black text-slate-950 dark:text-slate-100">{section.categoryName}</h2>
                    {section.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{section.description}</p>}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {section.products.map((product) => (
                  <MarketplaceProductCard key={product.id} product={product} />
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
            subtitle={location ? `Empresas que atendem sua cidade, ${location.city}.` : "Visão global do catálogo para inspeção da plataforma."}
          />
          {loadingCompanies && <LoadingCard label="Carregando lojas..." />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {companies?.map((company) => (
              <MarketplaceCompanyCard key={company.id} company={company} />
            ))}
            {companies?.length === 0 && !loadingCompanies && <LoadingCard label="Nenhuma loja encontrada para os filtros atuais." />}
          </div>
        </section>
        </>
        )}
      </main>
      {location && hasLocation && <PublicDiscoveryPanel city={location.city} state={location.state} zipCode={location.zipCode ?? ""} neighborhood={location.neighborhood} />}
    </>
  );
}

function ProfessionalMarketplaceGate({ role, panelHref, onCreateCustomer }: { role: Role; panelHref: string; onCreateCustomer: () => Promise<void> }) {
  const roleName: Partial<Record<Role,string>> = { [Role.ADMIN]:"administrador", [Role.FUNCIONARIO]:"funcionário", [Role.COZINHA]:"cozinha", [Role.MOTOBOY]:"motoboy", [Role.GARCOM]:"garçom", [Role.REVENDEDOR]:"revendedor" };
  return <main className="mx-auto grid min-h-[calc(100vh-70px)] max-w-5xl place-items-center px-4 py-12"><section className="relative w-full overflow-hidden rounded-[36px] bg-slate-950 p-7 text-white shadow-2xl sm:p-12"><div className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl"/><div className="relative grid items-center gap-10 lg:grid-cols-[1fr_.65fr]"><div><span className="inline-flex rounded-full bg-brand-500/15 px-3 py-1.5 text-xs font-black uppercase tracking-[.15em] text-brand-300">Conta profissional ativa</span><h1 className="mt-5 text-4xl font-black tracking-[-.04em] sm:text-5xl">Comprar e trabalhar são experiências separadas.</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">Você está conectado com um perfil de {roleName[role]??"equipe"}. Para proteger permissões, histórico e dados financeiros, perfis profissionais não visualizam produtos nem realizam pedidos.</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href={panelHref}><Button size="lg" className="w-full sm:w-auto">Voltar ao meu painel</Button></Link><Link href="/login?trocar-conta=cliente"><Button size="lg" variant="outline" className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:w-auto">Entrar como cliente</Button></Link></div><button className="mt-5 text-sm font-bold text-brand-300 hover:text-white hover:underline" onClick={onCreateCustomer}>Ainda não tenho conta de cliente — criar agora</button></div><div className="rounded-[28px] border border-white/10 bg-white/[.06] p-6"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-2xl">↔</div><h2 className="mt-6 text-xl font-black">Por que separar?</h2><div className="mt-4 space-y-3 text-sm leading-6 text-slate-400"><p>✓ Pedidos ficam no histórico pessoal correto.</p><p>✓ Endereços não se misturam aos dados da empresa.</p><p>✓ Permissões profissionais não chegam ao checkout.</p><p>✓ A auditoria da operação permanece confiável.</p></div></div></div></section></main>;
}

function ReadOnlyCatalogNotice() {
  return <aside className="mt-5 flex flex-col justify-between gap-4 rounded-2xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center dark:bg-violet-950/30 dark:border-violet-900/60"><div><p className="text-xs font-black uppercase tracking-wider text-violet-700 dark:text-violet-300">Super-admin · modo de inspeção</p><p className="mt-1 text-sm text-violet-900 dark:text-violet-200">Você pode navegar por todo o catálogo, mas compras continuam exclusivas para contas de cliente.</p></div><Link href="/login?trocar-conta=cliente" className="shrink-0 text-sm font-black text-violet-700 hover:underline dark:text-violet-300">Trocar para conta cliente →</Link></aside>;
}

function HowItWorks({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-38px_rgba(15,23,42,.45)] dark:bg-slate-900 dark:border-slate-800">
      <span className="text-xs font-black tracking-[0.16em] text-brand-600">{number}</span>
      <h3 className="mt-5 text-lg font-black text-slate-950 dark:text-slate-100">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{text}</p>
    </article>
  );
}

function LocationGate({ user, loading }: { user: ReturnType<typeof useAuthStore.getState>["user"]; loading: boolean }) {
  if (loading) {
    return <div className="mt-8 h-16 max-w-xl animate-pulse rounded-2xl bg-white/10" />;
  }
  const href = user ? "/minha-conta/enderecos" : "/cadastro";
  return (
    <div className="mt-8 max-w-xl rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-600 text-xl">📍</span>
        <div className="flex-1">
          <p className="font-black text-white">{user ? "Cadastre ou complete seu endereço com CEP" : "Informe seu endereço para ver o que está perto"}</p>
          <p className="mt-1 text-sm text-slate-300">O CEP ajuda a mostrar apenas lojas, produtos e ofertas que provavelmente atendem sua região.</p>
        </div>
        <Link href={href} className="shrink-0 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-brand-50">
          {user ? "Ver endereços" : "Criar conta"}
        </Link>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">{eyebrow}</p>
        <h2 className="text-2xl font-black text-slate-950 dark:text-slate-100">{title}</h2>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
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
      className={`group min-h-[108px] min-w-[138px] rounded-2xl border p-3 text-left transition sm:min-w-0 ${
        active
          ? "border-brand-200 bg-brand-600 text-white shadow-lift"
          : "border-slate-200 bg-white text-slate-700 shadow-soft hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300"
      }`}
    >
      <span
        className={`mb-3 grid h-10 w-10 place-items-center rounded-lg border ${
          active
            ? "border-white/25 bg-white/15 text-white"
            : "border-brand-100 bg-brand-50 text-brand-700 group-hover:border-brand-200 dark:bg-brand-950/30 dark:border-brand-900/50 dark:text-brand-300"
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
      className="group block overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift dark:bg-slate-900 dark:border-brand-900/60"
    >
      <div className="bg-gradient-to-r from-brand-600 to-accent-700 px-4 py-4 text-white">
        <p className="text-xs font-bold uppercase tracking-wide text-white/75">Oferta ativa</p>
        <p className="mt-1 text-3xl font-black">{discount}</p>
      </div>
      <div className="p-4">
        <div className="flex gap-3">
          <ProductImage src={promotion.company.logoUrl} alt={promotion.company.name} className="h-14 w-14 shrink-0" />
          <div className="min-w-0">
            <h3 className="line-clamp-1 font-black text-slate-950 group-hover:text-brand-700 dark:text-slate-100">{promotion.title}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{promotion.description || promotion.company.name}</p>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              {promotion.company.name} · {promotion.company.avgDeliveryTimeMinutes} min
            </p>
            {/*
              A promoção é só registro: o carrinho não abate nada sozinho, quem
              concede o desconto é a loja. Sem esta linha o card prometia um
              abatimento que o total do pedido nunca refletia.
            */}
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Desconto aplicado pela loja no atendimento.
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-white p-5 text-center text-sm font-medium text-slate-500 shadow-soft dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400">
      {label}
    </p>
  );
}
