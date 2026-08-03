"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Role } from "@chegowia/shared";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Category, Company, Product } from "@/lib/types";
import { useCartStore } from "@/lib/cart-store";
import { formatCurrency } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/catalog/product-image";
import { StoreAssistant } from "@/components/ai/store-assistant";

interface MenuResponse {
  company: { id: string; name: string; slug: string };
  categories: Category[];
}

export default function StorePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
  const readOnly = user?.role === Role.SUPER_ADMIN;
  const blockedProfessional = Boolean(user && user.role !== Role.CLIENTE && !readOnly);

  const { data: company, isLoading: loadingCompany } = useQuery({
    queryKey: ["public-company", slug],
    queryFn: async () => {
      const { data } = await api.get<Company>(`/companies/public/${slug}`);
      return data;
    },
  });

  const { data: menu, isLoading: loadingMenu } = useQuery({
    queryKey: ["public-menu", slug],
    queryFn: async () => {
      const { data } = await api.get<MenuResponse>(`/catalog/public/${slug}`);
      return data;
    },
  });

  const categories = useMemo(() => menu?.categories ?? [], [menu?.categories]);
  const featuredProducts = useMemo(
    () => categories.flatMap((category) => category.products ?? []).filter((product) => product.isFeatured).slice(0, 4),
    [categories],
  );

  const visibleCategories = useMemo(() => {
    const term = search.trim().toLowerCase();
    return categories
      .filter((category) => activeCategoryId === "all" || category.id === activeCategoryId)
      .map((category) => ({
        ...category,
        products: (category.products ?? []).filter((product) => {
          if (!term) return true;
          return [product.name, product.description, category.name].filter(Boolean).join(" ").toLowerCase().includes(term);
        }),
      }))
      .filter((category) => (category.products?.length ?? 0) > 0);
  }, [activeCategoryId, categories, search]);

  const items = useCartStore((s) => s.items);
  const cartCompanySlug = useCartStore((s) => s.companySlug);
  const cartCount = cartCompanySlug === slug ? items.reduce((sum, item) => sum + item.quantity, 0) : 0;
  const cartTotal = cartCompanySlug === slug ? items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) : 0;

  if (!hasHydrated || isSessionLoading) return <><PublicHeader /><main className="mx-auto max-w-6xl px-4 py-12"><div className="h-72 animate-pulse rounded-[32px] bg-slate-200 dark:bg-slate-700"/></main></>;
  if (blockedProfessional && user) return <><PublicHeader /><ProfessionalStoreGate role={user.role} /></>;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-5 pb-32 sm:py-8">
        {readOnly && <div className="mb-5 rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:bg-violet-950/30 dark:border-violet-900/60"><p className="text-xs font-black uppercase tracking-wider text-violet-700 dark:text-violet-300">Super-admin · somente leitura</p><p className="mt-1 text-sm text-violet-900 dark:text-violet-200">Você pode inspecionar loja e produtos. Para comprar, troque para uma conta de cliente.</p></div>}
        {loadingCompany && <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-500 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400">Carregando loja...</p>}
        {!loadingCompany && !company && <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-500 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400">Loja não encontrada.</p>}

        {company && (
          <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-36px_rgba(15,23,42,.4)] sm:p-7 dark:bg-slate-900 dark:border-slate-800/80">
            <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-brand-100/70 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 right-1/3 h-24 w-48 rounded-full bg-accent-100/50 blur-3xl" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <ProductImage src={company.logoUrl} alt={company.name} className="h-20 w-20 shrink-0 rounded-2xl shadow-lg sm:h-24 sm:w-24" />
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${company.isOpen !== false ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"}`}>
                      <span className={`h-2 w-2 rounded-full ${company.isOpen !== false ? "bg-emerald-500" : "bg-red-500"}`} /> {company.isOpen !== false ? "Aberto agora" : "Fechado agora"}
                    </span>
                    <Badge tone="info">Entrega em {company.avgDeliveryTimeMinutes} min</Badge>
                  </div>
                  <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl dark:text-slate-100">{company.name}</h1>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {[company.addressLine, company.city, company.state].filter(Boolean).join(", ")}
                  </p>
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-brand-700 dark:text-brand-300">
                    <span aria-hidden="true">✦</span> Cardápio atualizado <span className="font-medium text-slate-400">• escolha e peça em poucos passos</span>
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:min-w-64">
                <div className="rounded-2xl border border-brand-100 bg-brand-50/80 px-4 py-3 dark:border-brand-900/50">
                  <p className="text-xs font-semibold text-brand-900 dark:text-brand-200">Taxa de entrega</p>
                  <p className="text-lg font-black text-brand-700 dark:text-brand-300">a partir de {formatCurrency(Number(company.deliveryFeeBase))}</p>
                </div>
                <div className="rounded-2xl border border-accent-100 bg-accent-50/80 px-4 py-3">
                  <p className="text-xs font-semibold text-accent-900">Raio de entrega</p>
                  <p className="text-lg font-black text-accent-800">{Number(company.deliveryRadiusKm).toFixed(1)} km</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {loadingMenu && <p className="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-slate-500 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400">Carregando cardápio...</p>}

        {menu && (
          <div className="mt-6 min-w-0 space-y-6">
            <div className="sticky top-[65px] z-20 -mx-4 border-y border-slate-200/70 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border dark:bg-slate-900/90">
              <div className="grid gap-3 lg:grid-cols-[minmax(260px,.7fr)_1.3fr] lg:items-center">
                <label className="relative block">
                  <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-slate-400">
                    <SearchIcon />
                  </span>
                  <Input
                    className="h-12 rounded-xl border-slate-200 bg-slate-50 pl-11 shadow-none focus:bg-white dark:bg-slate-800/60 dark:border-slate-800"
                    placeholder="O que você quer pedir hoje?"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="flex gap-2 overflow-x-auto pb-1 lg:justify-end">
                  <CategoryButton active={activeCategoryId === "all"} onClick={() => setActiveCategoryId("all")}>
                    Tudo
                  </CategoryButton>
                  {categories.map((category) => (
                    <CategoryButton
                      key={category.id}
                      active={activeCategoryId === category.id}
                      onClick={() => setActiveCategoryId(category.id)}
                    >
                      {category.name}
                    </CategoryButton>
                  ))}
                </div>
              </div>
            </div>

            {featuredProducts.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Destaques</p>
                    <h2 className="text-xl font-black text-slate-950 dark:text-slate-100">Mais pedidos da loja</h2>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {featuredProducts.map((product) => (
                    <ProductCard key={product.id} product={product} onAdd={() => setActiveProduct(product)} featured readOnly={readOnly} />
                  ))}
                </div>
              </section>
            )}

            <div className="space-y-8">
              {visibleCategories.map((category) => (
                <section key={category.id}>
                  <div className="mb-3">
                    <h2 className="text-xl font-black text-slate-950 dark:text-slate-100">{category.name}</h2>
                    {category.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{category.description}</p>}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {category.products?.map((product) => (
                      <ProductCard key={product.id} product={product} onAdd={() => setActiveProduct(product)} readOnly={readOnly} />
                    ))}
                  </div>
                </section>
              ))}
              {visibleCategories.length === 0 && !loadingMenu && (
                <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400">
                  Nenhum produto encontrado para essa busca.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      {company && <StoreAssistant slug={slug} companyName={company.name} />}

      {activeProduct && (
        <ProductModal product={activeProduct} companySlug={slug} onClose={() => setActiveProduct(null)} readOnly={readOnly} />
      )}

      {!readOnly && cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:bg-slate-900/95 dark:border-slate-800">
          <div className="mx-auto max-w-5xl">
            <Link href="/carrinho">
              <Button className="h-14 w-full rounded-2xl text-base font-bold shadow-[0_16px_40px_-18px_rgba(234,88,12,.8)]" size="lg">
                Ver carrinho ({cartCount} {cartCount === 1 ? "item" : "itens"} · {formatCurrency(cartTotal)})
              </Button>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-2.5 text-sm font-bold transition ${
        active
          ? "border-brand-200 bg-brand-600 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
      }`}
    >
      {children}
    </button>
  );
}

function ProductCard({
  product,
  onAdd,
  featured = false,
  readOnly = false,
}: {
  product: Product;
  onAdd: () => void;
  featured?: boolean;
  readOnly?: boolean;
}) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,.45)] transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift dark:bg-slate-900 dark:border-slate-800/80">
      <div className="flex min-h-32 gap-4">
        <div className="relative shrink-0">
          <ProductImage src={product.imageUrl} alt={product.name} className="h-32 w-32 rounded-xl sm:h-36 sm:w-36" />
          {featured && <span className="absolute left-2 top-2 rounded-full bg-brand-600 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow">Popular</span>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-2 font-bold text-slate-950 group-hover:text-brand-700 dark:text-slate-100">{product.name}</h3>
            </div>
            {product.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{product.description}</p>}
          </div>
          <div className="mt-auto flex items-end justify-between gap-3 pt-3">
            <div>
              <p className="text-xs font-medium text-slate-400">a partir de</p>
              <p className="text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">{formatCurrency(Number(product.price))}</p>
            </div>
            <Button className="h-10 min-w-10 rounded-full px-3 text-sm shadow-md" size="sm" onClick={onAdd} aria-label={readOnly ? `Ver ${product.name}` : `Adicionar ${product.name}`}>
              {readOnly ? "Ver" : "+"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ProductModal({
  product,
  companySlug,
  onClose,
  readOnly = false,
}: {
  product: Product;
  companySlug: string;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const [variationId, setVariationId] = useState<string | undefined>(product.variations[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState(1);
  const addItem = useCartStore((s) => s.addItem);
  const setCompany = useCartStore((s) => s.setCompany);

  const variation = product.variations.find((item) => item.id === variationId);
  const selectedAddons = product.addons.filter((item) => addonIds.includes(item.id));
  const unitPrice =
    Number(product.price) +
    Number(variation?.priceDelta ?? 0) +
    selectedAddons.reduce((sum, addon) => sum + Number(addon.price), 0);

  function toggleAddon(id: string) {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((addonId) => addonId !== id) : [...prev, id]));
  }

  function handleConfirm() {
    setCompany(companySlug);
    const sortedAddonIds = [...addonIds].sort();
    const key = [product.id, variationId ?? "", sortedAddonIds.join(",")].join("::");
    addItem({
      key,
      productId: product.id,
      name: product.name,
      unitPrice,
      quantity,
      variationId,
      variationName: variation?.name,
      addonIds: sortedAddonIds.length ? sortedAddonIds : undefined,
      addonsLabel: selectedAddons.length ? selectedAddons.map((addon) => addon.name).join(", ") : undefined,
      notes: notes || undefined,
    });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={product.name}>
      <div className="max-h-[78vh] space-y-4 overflow-y-auto pr-1">
        <ProductImage src={product.imageUrl} alt={product.name} className="h-48 w-full" />
        {product.description && <p className="text-sm text-slate-500 dark:text-slate-400">{product.description}</p>}

        {product.variations.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-200">Escolha uma opção</p>
            <div className="space-y-2">
              {product.variations.map((variationItem) => (
                <label
                  key={variationItem.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="variation"
                      checked={variationId === variationItem.id}
                      onChange={() => setVariationId(variationItem.id)}
                    />
                    {variationItem.name}
                  </span>
                  {Number(variationItem.priceDelta) !== 0 && (
                    <span className="text-slate-500 dark:text-slate-400">
                      {Number(variationItem.priceDelta) > 0 ? "+" : ""}
                      {formatCurrency(Number(variationItem.priceDelta))}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {product.addons.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-200">Adicionais</p>
            <div className="space-y-2">
              {product.addons.map((addon) => (
                <label
                  key={addon.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                >
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={addonIds.includes(addon.id)} onChange={() => toggleAddon(addon.id)} />
                    {addon.name}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">+{formatCurrency(Number(addon.price))}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-sm font-bold text-slate-800 dark:text-slate-200">Observações</p>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: sem cebola" />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 dark:bg-slate-800/60 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 bg-white font-bold dark:bg-slate-900 dark:border-slate-700"
            >
              -
            </button>
            <span className="w-6 text-center font-bold">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((value) => value + 1)}
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 bg-white font-bold dark:bg-slate-900 dark:border-slate-700"
            >
              +
            </button>
          </div>
          <span className="text-xl font-black text-brand-700 dark:text-brand-300">{formatCurrency(unitPrice * quantity)}</span>
        </div>

        {readOnly ? <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-center dark:bg-violet-950/30 dark:border-violet-900/60"><p className="text-sm font-black text-violet-900 dark:text-violet-200">Visualização de super-admin</p><p className="mt-1 text-xs text-violet-700 dark:text-violet-300">Compras exigem uma conta separada com perfil de cliente.</p><Link href="/login?trocar-conta=cliente"><Button variant="outline" className="mt-3">Entrar como cliente</Button></Link></div> : <Button className="w-full" onClick={handleConfirm}>Adicionar ao carrinho</Button>}
      </div>
    </Modal>
  );
}

function ProfessionalStoreGate({ role }: { role: Role }) {
  return <main className="mx-auto grid min-h-[calc(100vh-70px)] max-w-3xl place-items-center px-4 py-12"><section className="w-full rounded-[32px] bg-slate-950 p-8 text-center text-white shadow-2xl"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-500 text-3xl">↔</div><p className="mt-6 text-xs font-black uppercase tracking-[.16em] text-brand-300">Perfil profissional</p><h1 className="mt-3 text-3xl font-black">Este cardápio é exclusivo para clientes.</h1><p className="mx-auto mt-4 max-w-xl leading-7 text-slate-300">Sua sessão atual possui permissões profissionais ({role.replaceAll("_"," ").toLowerCase()}). Para visualizar produtos e comprar, entre com sua conta pessoal de cliente ou crie uma.</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/login?trocar-conta=cliente"><Button size="lg">Entrar como cliente</Button></Link><Link href="/login?trocar-conta=cliente&novo=1"><Button size="lg" variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white">Criar conta de cliente</Button></Link></div></section></main>;
}
