"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Role } from "@chegowia/shared";
import { api, assetUrl } from "@/lib/api-client";
import { homePathForRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";
import { cartSubtotal, useCartStore } from "@/lib/cart-store";
import { useLogout } from "@/lib/use-auth";
import { Order } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/ui/badge";

type MenuKey = "orders" | "cart" | null;

export function PublicHeader() {
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isSessionLoading = useAuthStore((s) => s.isSessionLoading);
  const logout = useLogout();
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const cartItems = useCartStore((state) => state.items);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  const { data: orders } = useQuery({
    queryKey: ["header-my-orders"],
    queryFn: async () => {
      const { data } = await api.get<Order[]>("/me/orders");
      return data;
    },
    enabled: user?.role === Role.CLIENTE,
  });

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white shadow-sm">
            C
          </span>
          <span>ChegowIA</span>
        </Link>
        <nav className="relative flex items-center gap-2 text-sm">
          {!hasHydrated || isSessionLoading ? (
            <div className="h-10 w-32 rounded-lg bg-slate-100 dark:bg-slate-800" />
          ) : user?.role === Role.CLIENTE ? (
            <>
              <IconLink href="/minha-conta" title="Minha conta">
                <AvatarIcon userName={user.name} avatarUrl={user.avatarUrl} />
              </IconLink>

              <IconButton title="Meus pedidos" active={openMenu === "orders"} onClick={() => setOpenMenu(toggleMenu(openMenu, "orders"))}>
                <HeaderIcon name="orders" />
                {orders?.length ? <Counter>{Math.min(orders.length, 9)}</Counter> : null}
              </IconButton>

              <IconButton title="Carrinho" active={openMenu === "cart"} onClick={() => setOpenMenu(toggleMenu(openMenu, "cart"))}>
                <HeaderIcon name="cart" />
                {cartCount > 0 && <Counter>{Math.min(cartCount, 9)}</Counter>}
              </IconButton>

              <IconButton
                title="Sair"
                onClick={async () => {
                  await logout.mutateAsync();
                  setOpenMenu(null);
                }}
              >
                <HeaderIcon name="logout" />
              </IconButton>

              {openMenu === "orders" && <OrdersMenu orders={orders ?? []} onClose={() => setOpenMenu(null)} />}
              {openMenu === "cart" && <CartMenu onClose={() => setOpenMenu(null)} />}
            </>
          ) : user ? (
            <>
              <Link
                href={homePathForRole(user.role)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 font-medium text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              >
                <AvatarIcon userName={user.name} avatarUrl={user.avatarUrl} />
                <span>Painel</span>
              </Link>
              <IconButton
                title="Sair"
                onClick={async () => {
                  await logout.mutateAsync();
                  setOpenMenu(null);
                }}
              >
                <HeaderIcon name="logout" />
              </IconButton>
            </>
          ) : (
            <>
              <Link href="/login" className="font-medium text-slate-600 hover:text-slate-950 dark:text-slate-300">
                Entrar
              </Link>
              <Button size="sm" onClick={() => (window.location.href = "/cadastro")}>
                Criar conta
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function toggleMenu(current: MenuKey, next: Exclude<MenuKey, null>): MenuKey {
  return current === next ? null : next;
}

function IconLink({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
    >
      {children}
    </Link>
  );
}

function IconButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`relative grid h-10 w-10 place-items-center rounded-lg border shadow-sm transition ${
        active
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
      }`}
    >
      {children}
    </button>
  );
}

function Counter({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-black text-white">
      {children}
    </span>
  );
}

function AvatarIcon({ userName, avatarUrl }: { userName: string; avatarUrl?: string | null }) {
  const src = assetUrl(avatarUrl);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={userName} className="h-8 w-8 rounded-md object-cover" />
    );
  }
  return <span className="text-sm font-black text-brand-700">{initials(userName)}</span>;
}

function OrdersMenu({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const recent = orders.slice(0, 4);
  return (
    <Dropdown>
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="font-bold text-slate-950">Meus pedidos</p>
        <p className="text-xs text-slate-500">Acompanhe os últimos pedidos.</p>
      </div>
      <div className="max-h-80 overflow-y-auto p-2">
        {recent.map((order) => (
          <Link
            key={order.id}
            href={`/pedido/${order.id}`}
            onClick={onClose}
            className="block rounded-lg border border-transparent p-3 hover:border-brand-100 hover:bg-brand-50/60"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-slate-950">#{order.id.slice(0, 8)}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(order.createdAt)}</p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-2 text-sm font-black text-brand-700">{formatCurrency(Number(order.total))}</p>
          </Link>
        ))}
        {recent.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">Nenhum pedido recente.</p>}
      </div>
      <div className="border-t border-slate-100 p-2">
        <Link href="/minha-conta/pedidos" onClick={onClose}>
          <Button className="w-full" variant="outline">
            Ver histórico completo
          </Button>
        </Link>
      </div>
    </Dropdown>
  );
}

function CartMenu({ onClose }: { onClose: () => void }) {
  const items = useCartStore((state) => state.items);
  const subtotal = cartSubtotal(items);

  return (
    <Dropdown>
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="font-bold text-slate-950">Carrinho</p>
        <p className="text-xs text-slate-500">Revise os itens antes de finalizar.</p>
      </div>
      <div className="max-h-80 overflow-y-auto p-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-lg p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-1 font-bold text-slate-950">{item.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.quantity}x {item.variationName ? `· ${item.variationName}` : ""}
                </p>
                {item.addonsLabel && <p className="mt-1 line-clamp-1 text-xs text-slate-400">{item.addonsLabel}</p>}
              </div>
              <p className="shrink-0 text-sm font-black text-brand-700">{formatCurrency(item.unitPrice * item.quantity)}</p>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">Seu carrinho está vazio.</p>}
      </div>
      <div className="space-y-2 border-t border-slate-100 p-2">
        {items.length > 0 && (
          <div className="flex items-center justify-between px-2 py-1 text-sm">
            <span className="font-medium text-slate-500">Subtotal</span>
            <span className="font-black text-slate-950">{formatCurrency(subtotal)}</span>
          </div>
        )}
        <Link href="/carrinho" onClick={onClose}>
          <Button className="w-full" variant={items.length ? "primary" : "outline"}>
            Ver carrinho
          </Button>
        </Link>
      </div>
    </Dropdown>
  );
}

function Dropdown({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-0 top-12 z-40 w-[340px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
      {children}
    </div>
  );
}

function HeaderIcon({ name }: { name: "orders" | "cart" | "logout" }) {
  const paths = {
    orders: (
      <>
        <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1-2 1V3z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    cart: (
      <>
        <path d="M4 5h2l2 10h9l2-7H7" />
        <path d="M10 20h.01M17 20h.01" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
        <path d="M14 16l4-4-4-4" />
        <path d="M18 12H9" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      {paths[name]}
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
