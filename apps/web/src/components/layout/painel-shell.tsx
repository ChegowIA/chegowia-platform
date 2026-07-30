"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Role } from "@chegowia/shared";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { connectSocket } from "@/lib/socket-client";
import { useLogout } from "@/lib/use-auth";
import { playNewOrderSound, unlockNewOrderSound } from "@/lib/new-order-sound";

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/painel/dashboard", label: "Dashboard", roles: [Role.ADMIN, Role.FUNCIONARIO] },
  { href: "/painel/pedidos", label: "Pedidos", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA] },
  { href: "/painel/cardapio", label: "Cardápio", roles: [Role.ADMIN, Role.FUNCIONARIO] },
  { href: "/painel/entregas", label: "Entregas", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.MOTOBOY] },
  { href: "/painel/funcionarios", label: "Funcionários", roles: [Role.ADMIN, Role.FUNCIONARIO] },
  { href: "/painel/clientes", label: "Clientes", roles: [Role.ADMIN, Role.FUNCIONARIO] },
  { href: "/painel/relatorios", label: "Relatórios", roles: [Role.ADMIN, Role.FUNCIONARIO] },
  { href: "/painel/agente", label: "Agente de IA", roles: [Role.ADMIN, Role.FUNCIONARIO] },
  { href: "/painel/configuracoes", label: "Configurações", roles: [Role.ADMIN] },
];

function matchesPanelRoute(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

export function PainelShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const queryClient = useQueryClient();

  const items = NAV_ITEMS.filter((item) => user && item.roles.includes(user.role));
  const currentItem = NAV_ITEMS.find((item) => matchesPanelRoute(pathname, item.href));
  const canAccessCurrentRoute = Boolean(user && currentItem?.roles.includes(user.role));
  const fallbackHref = items[0]?.href ?? "/";

  const canSeeOrders = Boolean(user && NAV_ITEMS.find((item) => item.href === "/painel/pedidos")?.roles.includes(user.role));

  const { data: pendingOrders } = useQuery({
    queryKey: ["orders-pending-count"],
    queryFn: async () => {
      const { data } = await api.get<{ count: number }>("/orders/pending-count");
      return data;
    },
    enabled: canSeeOrders,
    refetchInterval: 30000,
  });

  useEffect(() => {
    const unlock = () => {
      unlockNewOrderSound();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!canSeeOrders) return;
    const socket = connectSocket();

    const handleCreated = () => {
      playNewOrderSound();
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders-pending-count"] });
    };
    const handleStatusChanged = () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders-pending-count"] });
    };

    socket.on("order.created", handleCreated);
    socket.on("order.status_changed", handleStatusChanged);
    return () => {
      socket.off("order.created", handleCreated);
      socket.off("order.status_changed", handleStatusChanged);
    };
  }, [canSeeOrders, queryClient]);

  useEffect(() => {
    if (!user || canAccessCurrentRoute) return;
    router.replace(fallbackHref);
  }, [canAccessCurrentRoute, fallbackHref, router, user]);

  if (!canAccessCurrentRoute) return null;

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-slate-50 text-slate-950 dark:bg-slate-950">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
        <div className="flex items-center gap-2 px-5 py-5 text-lg font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white shadow-sm">
            C
          </span>
          <span>ChegowIA</span>
        </div>
        <nav className="space-y-1 px-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm font-medium transition-colors",
                pathname?.startsWith(item.href)
                  ? "border-brand-200 bg-brand-50 text-brand-700 shadow-sm dark:bg-brand-900/30 dark:text-brand-300"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              <span>{item.label}</span>
              {item.href === "/painel/pedidos" && (pendingOrders?.count ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-brand-600 px-2 py-0.5 text-xs font-black text-white">
                  {pendingOrders!.count > 99 ? "99+" : pendingOrders!.count}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{user?.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Painel da empresa</p>
          </div>
          <button
            onClick={async () => {
              await logout.mutateAsync();
              router.replace("/login");
            }}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            Sair
          </button>
        </header>
        <main className="min-w-0 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
