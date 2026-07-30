"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
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

  const categories = menu?.categories ?? [];
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

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-28">
        {loadingCompany && <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-500">Carregando loja...</p>}
        {!loadingCompany && !company && <p className="rounded-lg border border-slate-200 bg-white p-5 text-slate-500">Loja não encontrada.</p>}

        {company && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <ProductImage src={company.logoUrl} alt={company.name} className="h-20 w-20 shrink-0" />
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge tone="brand">Loja ativa</Badge>
                    <Badge tone="info">{company.avgDeliveryTimeMinutes} min</Badge>
                  </div>
                  <h1 className="text-3xl font-black text-slate-950">{company.name}</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {[company.addressLine, company.city, company.state].filter(Boolean).join(", ")}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:min-w-64">
                <div className="rounded-lg bg-brand-50 px-4 py-3">
                  <p className="text-xs font-semibold text-brand-900">Entrega desde</p>
                  <p className="text-lg font-black text-brand-700">{formatCurrency(company.deliveryFeeBase)}</p>
                </div>
                <div className="rounded-lg bg-accent-50 px-4 py-3">
                  <p className="text-xs font-semibold text-accent-900">Tempo médio</p>
                  <p className="text-lg font-black text-accent-800">{company.avgDeliveryTimeMinutes} min</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {loadingMenu && <p className="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-slate-500">Carregando cardápio...</p>}

        {menu && (
          <div className="mt-6 min-w-0 space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                <Input
                  placeholder="Buscar produto, categoria ou ingrediente..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="flex gap-2 overflow-x-auto pb-1 md:max-w-[520px]">
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
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Destaques</p>
                    <h2 className="text-xl font-black text-slate-950">Mais pedidos da loja</h2>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {featuredProducts.map((product) => (
                    <ProductCard key={product.id} product={product} onAdd={() => setActiveProduct(product)} featured />
                  ))}
                </div>
              </section>
            )}

            <div className="space-y-8">
              {visibleCategories.map((category) => (
                <section key={category.id}>
                  <div className="mb-3">
                    <h2 className="text-xl font-black text-slate-950">{category.name}</h2>
                    {category.description && <p className="mt-1 text-sm text-slate-500">{category.description}</p>}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {category.products?.map((product) => (
                      <ProductCard key={product.id} product={product} onAdd={() => setActiveProduct(product)} />
                    ))}
                  </div>
                </section>
              ))}
              {visibleCategories.length === 0 && !loadingMenu && (
                <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">
                  Nenhum produto encontrado para essa busca.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      {company && <StoreAssistant slug={slug} companyName={company.name} />}

      {activeProduct && (
        <ProductModal product={activeProduct} companySlug={slug} onClose={() => setActiveProduct(null)} />
      )}

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
          <div className="mx-auto max-w-5xl">
            <Link href="/carrinho">
              <Button className="w-full" size="lg">
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
      className={`shrink-0 rounded-full border px-3 py-2 text-sm font-semibold transition ${
        active
          ? "border-brand-200 bg-brand-600 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
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
}: {
  product: Product;
  onAdd: () => void;
  featured?: boolean;
}) {
  return (
    <article className="group rounded-lg border border-slate-200 bg-white p-3 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift">
      <div className="flex gap-3">
        <ProductImage src={product.imageUrl} alt={product.name} className="h-28 w-28 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-2 font-bold text-slate-950 group-hover:text-brand-700">{product.name}</h3>
              {featured && <Badge tone="brand">Destaque</Badge>}
            </div>
            {product.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{product.description}</p>}
          </div>
          <div className="mt-auto flex items-end justify-between gap-3 pt-3">
            <div>
              <p className="text-xs font-medium text-slate-400">A partir de</p>
              <p className="text-lg font-black text-brand-700">{formatCurrency(Number(product.price))}</p>
            </div>
            <Button size="sm" onClick={onAdd}>
              Adicionar
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductModal({
  product,
  companySlug,
  onClose,
}: {
  product: Product;
  companySlug: string;
  onClose: () => void;
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
        {product.description && <p className="text-sm text-slate-500">{product.description}</p>}

        {product.variations.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold text-slate-800">Escolha uma opção</p>
            <div className="space-y-2">
              {product.variations.map((variationItem) => (
                <label
                  key={variationItem.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                    <span className="text-slate-500">
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
            <p className="mb-2 text-sm font-bold text-slate-800">Adicionais</p>
            <div className="space-y-2">
              {product.addons.map((addon) => (
                <label
                  key={addon.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={addonIds.includes(addon.id)} onChange={() => toggleAddon(addon.id)} />
                    {addon.name}
                  </span>
                  <span className="text-slate-500">+{formatCurrency(Number(addon.price))}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-sm font-bold text-slate-800">Observações</p>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: sem cebola" />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 bg-white font-bold"
            >
              -
            </button>
            <span className="w-6 text-center font-bold">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((value) => value + 1)}
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 bg-white font-bold"
            >
              +
            </button>
          </div>
          <span className="text-xl font-black text-brand-700">{formatCurrency(unitPrice * quantity)}</span>
        </div>

        <Button className="w-full" onClick={handleConfirm}>
          Adicionar ao carrinho
        </Button>
      </div>
    </Modal>
  );
}
