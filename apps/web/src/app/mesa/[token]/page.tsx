"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import clsx from "clsx";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Category, Product } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { ProductImage } from "@/components/catalog/product-image";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

interface PublicTableMenu {
  company: { name: string; logoUrl?: string | null };
  table: { name: string; seats: number; area?: string | null };
  session: {
    isOpen: true;
    guestCount: number;
    isBeingAttended: boolean;
    openedAt: string;
  } | null;
  categories: Category[];
}

interface TableCartItem {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  variationId?: string;
  addonIds?: string[];
  notes?: string;
  choicesLabel?: string;
}

export default function TableQrMenuPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<TableCartItem[]>([]);
  const [openForm, setOpenForm] = useState({ customerName: "", customerPhone: "", guestCount: "2", notes: "" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  const menuQuery = useQuery({
    queryKey: ["public-table-menu", token],
    queryFn: async () => (await api.get<PublicTableMenu>(`/tables/public/${encodeURIComponent(token)}`)).data,
    retry: 1,
  });
  const menu = menuQuery.data;

  const openTable = useMutation({
    mutationFn: () => api.post(`/tables/public/${encodeURIComponent(token)}/open`, {
      customerName: openForm.customerName.trim() || undefined,
      customerPhone: openForm.customerPhone.trim() || undefined,
      guestCount: Number(openForm.guestCount),
      notes: openForm.notes.trim() || undefined,
    }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["public-table-menu", token] });
    },
    onError: (error) => setActionError(apiErrorMessage(error)),
  });

  const sendOrder = useMutation({
    mutationFn: () => api.post(`/tables/public/${encodeURIComponent(token)}/orders`, {
      items: cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        variationId: item.variationId,
        addonIds: item.addonIds,
        notes: item.notes,
      })),
    }),
    onSuccess: ({ data }) => {
      setCart([]);
      setCartOpen(false);
      setActionError(null);
      setOrderSuccess(`${data.itemCount} ${data.itemCount === 1 ? "item enviado" : "itens enviados"} para a cozinha.`);
      queryClient.invalidateQueries({ queryKey: ["public-table-menu", token] });
    },
    onError: (error) => setActionError(apiErrorMessage(error)),
  });

  const categories = useMemo(() => menu?.categories ?? [], [menu?.categories]);
  const visibleCategories = useMemo(() => {
    const normalized = normalize(search);
    return categories
      .filter((category) => activeCategoryId === "all" || category.id === activeCategoryId)
      .map((category) => ({
        ...category,
        products: (category.products ?? []).filter((product) => !normalized || normalize([product.name, product.description, category.name].filter(Boolean).join(" ")).includes(normalized)),
      }))
      .filter((category) => (category.products?.length ?? 0) > 0);
  }, [activeCategoryId, categories, search]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  function addToCart(item: Omit<TableCartItem, "key">) {
    setCart((current) => [...current, { ...item, key: `${item.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }]);
    setOrderSuccess(null);
  }

  function updateQuantity(key: string, quantity: number) {
    setCart((current) => quantity <= 0
      ? current.filter((item) => item.key !== key)
      : current.map((item) => item.key === key ? { ...item, quantity } : item));
  }

  if (menuQuery.isLoading) return <PublicLoading />;
  if (menuQuery.isError || !menu) return <PublicUnavailable />;

  return (
    <main className="min-h-screen bg-[#f8fafc] pb-32 text-slate-950 dark:bg-[#080d18] dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProductImage src={menu.company.logoUrl} alt={menu.company.name} className="h-11 w-11 shrink-0 rounded-xl" />
            <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[.15em] text-brand-700 dark:text-brand-300">Pedido no salão</p><h1 className="truncate text-base font-black">{menu.company.name}</h1></div>
          </div>
          <div className="shrink-0 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-right dark:border-brand-900/60 dark:bg-brand-950/30"><p className="text-[9px] font-black uppercase tracking-wide text-brand-700 dark:text-brand-300">Sua mesa</p><p className="text-sm font-black text-brand-800 dark:text-brand-200">{menu.table.name}</p></div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:py-7">
        <section className="relative overflow-hidden rounded-[28px] bg-slate-950 p-5 text-white shadow-[0_24px_64px_-30px_rgba(15,23,42,.7)] sm:p-7">
          <div className="pointer-events-none absolute -right-14 -top-20 h-52 w-52 rounded-full bg-brand-500/30 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[.15em] text-brand-200"><span className="h-2 w-2 rounded-full bg-emerald-400" />Pedido vinculado à mesa</div>
            <h2 className="mt-4 text-3xl font-black tracking-tight">Peça do seu jeito.</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Tudo o que você escolher aqui entra diretamente na comanda da <b className="text-white">{menu.table.name}</b> e segue para a equipe.</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-slate-300"><span className="rounded-full bg-white/10 px-3 py-1.5">{menu.table.area || "Salão"}</span><span className="rounded-full bg-white/10 px-3 py-1.5">até {menu.table.seats} pessoas</span>{menu.session?.isBeingAttended && <span className="rounded-full bg-emerald-400/15 px-3 py-1.5 text-emerald-200">Equipe acompanhando</span>}</div>
          </div>
        </section>

        {!menu.session && (
          <section className="rounded-[26px] border border-brand-200 bg-white p-5 shadow-sm dark:border-brand-900/60 dark:bg-slate-900 sm:p-6">
            <div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-lg text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">1</span><div><h2 className="font-black">Confirme os dados da mesa</h2><p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">É rápido e abre a comanda para seus pedidos. Somente a equipe poderá fechar a mesa.</p></div></div>
            <div className="mt-5 space-y-4">
              <FormField label="Como podemos chamar você? (opcional)"><Input value={openForm.customerName} onChange={(event) => setOpenForm({ ...openForm, customerName: event.target.value })} placeholder="Seu nome" /></FormField>
              <div className="grid gap-3 sm:grid-cols-2"><FormField label="Telefone (opcional)"><Input type="tel" value={openForm.customerPhone} onChange={(event) => setOpenForm({ ...openForm, customerPhone: event.target.value })} placeholder="(00) 00000-0000" /></FormField><FormField label="Quantas pessoas? "><Input type="number" min={1} max={menu.table.seats} value={openForm.guestCount} onChange={(event) => setOpenForm({ ...openForm, guestCount: event.target.value })} /></FormField></div>
              <FormField label="Alguma observação? (opcional)"><Textarea rows={2} value={openForm.notes} onChange={(event) => setOpenForm({ ...openForm, notes: event.target.value })} placeholder="Ex.: estamos com criança, precisamos de cadeirinha" /></FormField>
              {actionError && <ActionError message={actionError} />}
              <Button className="w-full" isLoading={openTable.isPending} onClick={() => openTable.mutate()} disabled={!Number(openForm.guestCount) || Number(openForm.guestCount) < 1 || Number(openForm.guestCount) > menu.table.seats}>Abrir mesa e começar a pedir</Button>
            </div>
          </section>
        )}

        {menu.session && <section className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30"><span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-sm font-black text-white">✓</span><p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">Mesa aberta. Escolha seus itens e envie quando estiver pronto.</p></section>}
        {orderSuccess && <section className="flex items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-bold text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-200"><span>{orderSuccess}</span><button type="button" onClick={() => setOrderSuccess(null)} className="text-lg leading-none opacity-60 hover:opacity-100" aria-label="Fechar mensagem">×</button></section>}

        <section className="sticky top-[68px] z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <label className="relative block"><span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-slate-400"><SearchIcon /></span><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 rounded-xl bg-slate-50 pl-10 dark:bg-slate-800" placeholder="Buscar no cardápio" /></label>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1"><CategoryChip active={activeCategoryId === "all"} onClick={() => setActiveCategoryId("all")}>Tudo</CategoryChip>{categories.map((category) => <CategoryChip key={category.id} active={category.id === activeCategoryId} onClick={() => setActiveCategoryId(category.id)}>{category.name}</CategoryChip>)}</div>
        </section>

        <section className="space-y-7">
          {visibleCategories.map((category) => <div key={category.id}><div className="mb-3"><p className="text-[10px] font-black uppercase tracking-[.16em] text-brand-700 dark:text-brand-300">Cardápio</p><h2 className="text-xl font-black">{category.name}</h2>{category.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{category.description}</p>}</div><div className="grid gap-3 sm:grid-cols-2">{category.products?.map((product) => <TableProductCard key={product.id} product={product} onClick={() => setActiveProduct(product)} />)}</div></div>)}
          {!visibleCategories.length && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Nenhum item encontrado. Tente outra busca.</div>}
        </section>
      </div>

      {cartCount > 0 && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95"><div className="mx-auto max-w-3xl"><Button className="h-14 w-full justify-between rounded-2xl px-5 text-base" onClick={() => setCartOpen(true)}><span>Ver pedido · {cartCount} {cartCount === 1 ? "item" : "itens"}</span><span>{formatCurrency(cartTotal)}</span></Button></div></div>}

      {activeProduct && <TableProductModal product={activeProduct} onClose={() => setActiveProduct(null)} onConfirm={(item) => { addToCart(item); setActiveProduct(null); }} />}
      <TableCartModal open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} total={cartTotal} canSend={Boolean(menu.session)} isSending={sendOrder.isPending} error={actionError} onQuantity={updateQuantity} onSend={() => sendOrder.mutate()} />
    </main>
  );
}

function TableProductCard({ product, onClick }: { product: Product; onClick: () => void }) {
  return <article className="flex min-h-32 gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 dark:border-slate-800 dark:bg-slate-900"><ProductImage src={product.imageUrl} alt={product.name} className="h-28 w-28 shrink-0 rounded-xl" /><div className="flex min-w-0 flex-1 flex-col"><div><h3 className="line-clamp-2 font-black">{product.name}</h3>{product.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{product.description}</p>}</div><div className="mt-auto flex items-end justify-between gap-2 pt-3"><p className="text-lg font-black text-brand-700 dark:text-brand-300">{formatCurrency(Number(product.price))}</p><Button type="button" size="sm" className="h-9 min-w-9 rounded-full px-3" onClick={onClick} aria-label={`Adicionar ${product.name}`}>+</Button></div></div></article>;
}

function TableProductModal({ product, onClose, onConfirm }: { product: Product; onClose: () => void; onConfirm: (item: Omit<TableCartItem, "key">) => void }) {
  const [variationId, setVariationId] = useState<string | undefined>(product.variations[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState(1);
  const variation = product.variations.find((item) => item.id === variationId);
  const addons = product.addons.filter((item) => addonIds.includes(item.id));
  const unitPrice = Number(product.price) + Number(variation?.priceDelta ?? 0) + addons.reduce((sum, item) => sum + Number(item.price), 0);
  const choicesLabel = [variation?.name, addons.length ? `+ ${addons.map((item) => item.name).join(", ")}` : null].filter(Boolean).join(" · ");
  const toggleAddon = (id: string) => setAddonIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <Modal open onClose={onClose} title={product.name}><div className="max-h-[76vh] space-y-4 overflow-y-auto pr-1"><ProductImage src={product.imageUrl} alt={product.name} className="h-44 w-full rounded-2xl" />{product.description && <p className="text-sm text-slate-500 dark:text-slate-400">{product.description}</p>}{product.variations.length > 0 && <OptionGroup title="Escolha uma opção">{product.variations.map((item) => <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800"><span className="flex items-center gap-2"><input type="radio" name="table-product-variation" checked={variationId === item.id} onChange={() => setVariationId(item.id)} />{item.name}</span>{Number(item.priceDelta) !== 0 && <span className="font-bold text-brand-700 dark:text-brand-300">{Number(item.priceDelta) > 0 ? "+" : ""}{formatCurrency(Number(item.priceDelta))}</span>}</label>)}</OptionGroup>}{product.addons.length > 0 && <OptionGroup title="Adicionais">{product.addons.map((item) => <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800"><span className="flex items-center gap-2"><input type="checkbox" checked={addonIds.includes(item.id)} onChange={() => toggleAddon(item.id)} />{item.name}</span><span className="font-bold text-brand-700 dark:text-brand-300">+{formatCurrency(Number(item.price))}</span></label>)}</OptionGroup>}<FormField label="Observação"><Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: sem cebola" /></FormField><div className="flex items-center justify-between rounded-2xl bg-slate-100 p-3 dark:bg-slate-800"><div className="flex items-center gap-3"><button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg font-black shadow-sm dark:bg-slate-900" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><span className="w-5 text-center font-black">{quantity}</span><button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg font-black shadow-sm dark:bg-slate-900" onClick={() => setQuantity((value) => value + 1)}>+</button></div><span className="text-xl font-black text-brand-700 dark:text-brand-300">{formatCurrency(unitPrice * quantity)}</span></div><Button className="w-full" onClick={() => onConfirm({ productId: product.id, name: product.name, quantity, unitPrice, variationId, addonIds: addonIds.length ? addonIds : undefined, notes: notes.trim() || undefined, choicesLabel: choicesLabel || undefined })}>Adicionar ao pedido</Button></div></Modal>;
}

function TableCartModal({ open, onClose, cart, total, canSend, isSending, error, onQuantity, onSend }: { open: boolean; onClose: () => void; cart: TableCartItem[]; total: number; canSend: boolean; isSending: boolean; error: string | null; onQuantity: (key: string, quantity: number) => void; onSend: () => void }) {
  return <Modal open={open} onClose={onClose} title="Seu pedido"><div className="space-y-4"><p className="text-sm text-slate-500 dark:text-slate-400">O pedido entra na comanda desta mesa e a equipe cuida do restante.</p><div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">{cart.map((item) => <div key={item.key} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800"><div className="flex justify-between gap-3"><div className="min-w-0"><p className="font-black">{item.name}</p>{item.choicesLabel && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.choicesLabel}</p>}{item.notes && <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">“{item.notes}”</p>}</div><p className="shrink-0 font-black">{formatCurrency(item.quantity * item.unitPrice)}</p></div><div className="mt-3 flex items-center gap-3"><button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 font-black dark:bg-slate-800" onClick={() => onQuantity(item.key, item.quantity - 1)}>−</button><span className="w-4 text-center text-sm font-black">{item.quantity}</span><button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 font-black dark:bg-slate-800" onClick={() => onQuantity(item.key, item.quantity + 1)}>+</button></div></div>)}</div><div className="flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-3 text-white"><span className="text-sm font-bold">Total do pedido</span><span className="text-xl font-black">{formatCurrency(total)}</span></div>{!canSend && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">Confirme os dados da mesa acima antes de enviar o pedido.</div>}{error && <ActionError message={error} />}<Button className="w-full" disabled={!canSend || !cart.length} isLoading={isSending} onClick={onSend}>Enviar para a cozinha</Button><p className="text-center text-xs leading-5 text-slate-400">O pagamento e o fechamento da mesa são feitos somente com a equipe do estabelecimento.</p></div></Modal>;
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={clsx("shrink-0 rounded-full border px-3.5 py-2 text-xs font-black transition", active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300")}>{children}</button>;
}

function OptionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-sm font-black">{title}</p><div className="space-y-2">{children}</div></div>;
}

function ActionError({ message }: { message: string }) {
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{message}</div>;
}

function PublicLoading() {
  return <main className="grid min-h-screen place-items-center bg-[#f8fafc] p-5 dark:bg-[#080d18]"><div className="w-full max-w-sm animate-pulse rounded-[30px] bg-slate-200 p-8 dark:bg-slate-800"><div className="h-5 w-32 rounded bg-slate-300 dark:bg-slate-700" /><div className="mt-5 h-24 rounded-2xl bg-slate-300 dark:bg-slate-700" /></div></main>;
}

function PublicUnavailable() {
  return <main className="grid min-h-screen place-items-center bg-[#f8fafc] p-5 dark:bg-[#080d18]"><section className="max-w-sm rounded-[30px] border border-slate-200 bg-white p-7 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-2xl dark:bg-amber-950/40">!</div><h1 className="mt-5 text-2xl font-black">QR da mesa indisponível</h1><p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">Peça ajuda à equipe do estabelecimento para confirmar a mesa ou usar um novo QR Code.</p></section></main>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
