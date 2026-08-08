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
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { PublicAccessActions } from "@/components/layout/public-access-actions";

type MenuKey = "orders" | "cart" | "account" | null;

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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 min-[360px]:gap-3 min-[360px]:px-4">
        <Link href="/" aria-label="ChegowIA — início" className="flex shrink-0 items-center">
          <BrandLogo adaptive className="h-7 w-[92px] min-[360px]:h-8 min-[360px]:w-[112px] min-[380px]:w-[126px] sm:h-9 sm:w-[145px]" />
        </Link>
        <nav className="relative flex shrink-0 items-center gap-1 text-sm sm:gap-2">
          {/* Fora do condicional: o tema é escolha de qualquer pessoa, logada ou não. */}
          <ThemeToggle className="h-8 w-8 min-[360px]:h-9 min-[360px]:w-9 sm:h-10 sm:w-10" />
          {!hasHydrated || isSessionLoading ? (
            <div className="h-10 w-32 rounded-lg bg-slate-100 dark:bg-slate-800" />
          ) : user?.role === Role.CLIENTE ? (
            <>
              <div className="flex items-center gap-1 sm:gap-2">
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
              </div>

              {openMenu === "orders" && <OrdersMenu orders={orders ?? []} onClose={() => setOpenMenu(null)} />}
              {openMenu === "cart" && <CartMenu onClose={() => setOpenMenu(null)} />}
            </>
          ) : user ? (
            <>
              <div className="hidden items-center gap-2 sm:flex">
                <Link
                  href={homePathForRole(user.role)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 font-medium text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
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
              </div>
              <div className="sm:hidden">
                <IconButton title="Abrir menu da conta" active={openMenu === "account"} onClick={() => setOpenMenu(toggleMenu(openMenu, "account"))}>
                  <AvatarIcon userName={user.name} avatarUrl={user.avatarUrl} />
                </IconButton>
              </div>
              {openMenu === "account" && (
                <PanelAccountMenu
                  userName={user.name}
                  avatarUrl={user.avatarUrl}
                  panelHref={homePathForRole(user.role)}
                  onClose={() => setOpenMenu(null)}
                  onLogout={async () => {
                    await logout.mutateAsync();
                    setOpenMenu(null);
                  }}
                />
              )}
            </>
          ) : (
            <PublicAccessActions />
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
      className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 min-[360px]:h-9 min-[360px]:w-9 sm:h-10 sm:w-10"
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
      className={`relative grid h-8 w-8 place-items-center rounded-lg border shadow-sm transition min-[360px]:h-9 min-[360px]:w-9 sm:h-10 sm:w-10 ${
        active
          ? "border-brand-200 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:border-brand-900/60 dark:text-brand-300"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

function Counter({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-0.5 text-[8px] font-black text-white min-[360px]:h-5 min-[360px]:min-w-5 min-[360px]:px-1 min-[360px]:text-[10px]">
      {children}
    </span>
  );
}

function AvatarIcon({ userName, avatarUrl }: { userName: string; avatarUrl?: string | null }) {
  const src = assetUrl(avatarUrl);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={userName} className="h-6 w-6 rounded-md object-cover min-[360px]:h-7 min-[360px]:w-7 sm:h-8 sm:w-8" />
    );
  }
  return <span className="text-[10px] font-black text-brand-700 dark:text-brand-300 min-[360px]:text-xs sm:text-sm">{initials(userName)}</span>;
}

function OrdersMenu({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const recent = orders.slice(0, 4);
  return (
    <Dropdown>
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <p className="font-bold text-slate-950 dark:text-slate-100">Meus pedidos</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Acompanhe os últimos pedidos.</p>
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
                <p className="font-bold text-slate-950 dark:text-slate-100">#{order.id.slice(0, 8)}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(order.createdAt)}</p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-2 text-sm font-black text-brand-700 dark:text-brand-300">{formatCurrency(Number(order.total))}</p>
          </Link>
        ))}
        {recent.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Nenhum pedido recente.</p>}
      </div>
      <div className="border-t border-slate-100 p-2 dark:border-slate-800">
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
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <p className="font-bold text-slate-950 dark:text-slate-100">Carrinho</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Revise os itens antes de finalizar.</p>
      </div>
      <div className="max-h-80 overflow-y-auto p-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-lg p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-1 font-bold text-slate-950 dark:text-slate-100">{item.name}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {item.quantity}x {item.variationName ? `· ${item.variationName}` : ""}
                </p>
                {item.addonsLabel && <p className="mt-1 line-clamp-1 text-xs text-slate-400">{item.addonsLabel}</p>}
              </div>
              <p className="shrink-0 text-sm font-black text-brand-700 dark:text-brand-300">{formatCurrency(item.unitPrice * item.quantity)}</p>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Seu carrinho está vazio.</p>}
      </div>
      <div className="space-y-2 border-t border-slate-100 p-2 dark:border-slate-800">
        {items.length > 0 && (
          <div className="flex items-center justify-between px-2 py-1 text-sm">
            <span className="font-medium text-slate-500 dark:text-slate-400">Subtotal</span>
            <span className="font-black text-slate-950 dark:text-slate-100">{formatCurrency(subtotal)}</span>
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

function PanelAccountMenu({
  userName,
  avatarUrl,
  panelHref,
  onClose,
  onLogout,
}: {
  userName: string;
  avatarUrl?: string | null;
  panelHref: string;
  onClose: () => void;
  onLogout: () => Promise<void>;
}) {
  return (
    <Dropdown>
      <AccountMenuIntro userName={userName} avatarUrl={avatarUrl} eyebrow="Sua área de trabalho" />
      <div className="space-y-1 p-2">
        <AccountMenuLink href={panelHref} icon="panel" onClick={onClose} label="Abrir painel" description="Voltar para sua operação" />
      </div>
      <AccountMenuFooter onLogout={onLogout} />
    </Dropdown>
  );
}

function AccountMenuIntro({ userName, avatarUrl, eyebrow }: { userName: string; avatarUrl?: string | null; eyebrow: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 dark:bg-brand-950/30">
        <AvatarIcon userName={userName} avatarUrl={avatarUrl} />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[.14em] text-brand-700 dark:text-brand-300">{eyebrow}</p>
        <p className="truncate font-bold text-slate-950 dark:text-slate-100">{userName}</p>
      </div>
    </div>
  );
}

function AccountMenuLink({
  href,
  icon,
  label,
  description,
  onClick,
}: {
  href: string;
  icon: "account" | "orders" | "cart" | "panel";
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className="flex items-center gap-3 rounded-xl p-2.5 transition hover:bg-brand-50 dark:hover:bg-brand-950/25">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <HeaderIcon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">{label}</span>
        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{description}</span>
      </span>
      <span aria-hidden className="text-slate-400">›</span>
    </Link>
  );
}

function AccountMenuFooter({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <div className="border-t border-slate-100 p-2 dark:border-slate-800">
      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 dark:text-slate-400 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
      >
        <HeaderIcon name="logout" />
        Sair da conta
      </button>
    </div>
  );
}

function Dropdown({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-0 top-12 z-40 w-[min(340px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:bg-slate-900 dark:border-slate-800">
      {children}
    </div>
  );
}

function HeaderIcon({ name }: { name: "orders" | "cart" | "logout" | "account" | "panel" }) {
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
    account: (
      <>
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.5 20c.7-3.2 3.1-5 6.5-5s5.8 1.8 6.5 5" />
      </>
    ),
    panel: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
        <path d="M8 9h8M8 13h5M8 17h3" />
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
