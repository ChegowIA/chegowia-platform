"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionKey, Role } from "@chegowia/shared";
import { api } from "@/lib/api-client";
import { AuthUser, useAuthStore } from "@/lib/auth-store";
import { connectSocket } from "@/lib/socket-client";
import { useLogout } from "@/lib/use-auth";
import { playNewOrderAlert, unlockNewOrderSound } from "@/lib/new-order-sound";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AdminAssistantBubble } from "@/components/ai/admin-assistant-bubble";
import { KitchenAssistant } from "@/components/ai/kitchen-assistant";
import { MobileDock } from "@/components/layout/mobile-dock";
import { NonCriticalBoundary } from "@/components/system/non-critical-boundary";

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
  permissions?: PermissionKey[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/painel/dashboard", label: "Dashboard", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.PEDIDOS_VISUALIZAR] },
  { href: "/painel/atendimento", label: "Atendimento", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.PEDIDOS_VISUALIZAR] },
  { href: "/painel/pedidos", label: "Pedidos", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.PEDIDOS_VISUALIZAR] },
  { href: "/painel/mesas", label: "Mesas e salão", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.MESAS_VISUALIZAR] },
  { href: "/painel/cardapio", label: "Cardápio", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.CARDAPIO_VISUALIZAR] },
  { href: "/painel/entregas", label: "Entregas", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.ENTREGAS_VISUALIZAR] },
  { href: "/painel/funcionarios", label: "Funcionários", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.FUNCIONARIOS_VISUALIZAR] },
  { href: "/painel/clientes", label: "Clientes", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.PEDIDOS_VISUALIZAR] },
  { href: "/painel/relatorios", label: "Relatórios", roles: [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM], permissions: [PermissionKey.RELATORIOS_VISUALIZAR] },
  { href: "/painel/caixa", label: "Caixa", roles: [Role.ADMIN, Role.FUNCIONARIO], permissions: [PermissionKey.CAIXA_VISUALIZAR] },
  { href: "/painel/fiscal", label: "Fiscal", roles: [Role.ADMIN, Role.FUNCIONARIO], permissions: [PermissionKey.FISCAL_VISUALIZAR] },
  { href: "/painel/configuracoes", label: "Configurações", roles: [Role.ADMIN] },
  { href: "/painel/assinatura", label: "Assinatura", roles: [Role.ADMIN] },
];

function matchesPanelRoute(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

function canUsePanelItem(user: { role: Role; permissionKeys?: PermissionKey[] }, item: NavItem) {
  if (!item.roles.includes(user.role)) return false;
  if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) return true;
  return (item.permissions ?? []).every((permission) => user.permissionKeys?.includes(permission));
}

export function PainelShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setSession = useAuthStore((s) => s.setSession);
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const queryClient = useQueryClient();

  const items = NAV_ITEMS.filter((item) => user && canUsePanelItem(user, item));
  const currentItem = NAV_ITEMS.find((item) => matchesPanelRoute(pathname, item.href));
  const canAccessCurrentRoute = Boolean(user && currentItem && canUsePanelItem(user, currentItem));
  const fallbackHref = items[0]?.href ?? "/";

  const canSeeOrders = Boolean(user && NAV_ITEMS.find((item) => item.href === "/painel/pedidos") && canUsePanelItem(user, NAV_ITEMS.find((item) => item.href === "/painel/pedidos")!));
  const {data:billingStatus}=useQuery({
    queryKey:["company-billing-status"],
    queryFn:async()=>(await api.get("/billing/company/status")).data as {accessRestricted:boolean},
    enabled:user?.role===Role.ADMIN,
    retry:false,
  });

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
      const isOrdersArea = matchesPanelRoute(pathname, "/painel/pedidos");
      // A listagem possui um listener local para garantir a conexão e as duas
      // repetições mesmo após navegações. Detalhes continuam sob o shell.
      if (pathname !== "/painel/pedidos") playNewOrderAlert(isOrdersArea ? 2 : 4);
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
  }, [canSeeOrders, pathname, queryClient]);

  useEffect(() => {
    if (!user || !accessToken) return;
    const socket = connectSocket();
    const refreshAccess = async () => {
      try {
        const { data } = await api.get<AuthUser>("/auth/me");
        setSession(accessToken, data);
      } catch {
        // A proteção do backend continua valendo; a próxima atualização de
        // sessão tentará sincronizar a interface novamente.
      }
      // As salas do socket são escolhidas no handshake a partir das permissões
      // da época. Sem reconectar, quem acabou de ganhar acesso a Entregas
      // continuaria fora da sala até recarregar a página — e quem perdeu
      // seguiria recebendo os eventos.
      socket.disconnect();
      socket.connect();
    };
    socket.on("access.updated", refreshAccess);
    return () => {
      socket.off("access.updated", refreshAccess);
    };
  }, [accessToken, setSession, user]);

  useEffect(() => {
    if (!user || !items.length || canAccessCurrentRoute) return;
    router.replace(fallbackHref);
  }, [canAccessCurrentRoute, fallbackHref, items.length, router, user]);

  useEffect(()=>{
    if(user?.role===Role.ADMIN&&billingStatus?.accessRestricted&&pathname!=="/painel/assinatura"){
      router.replace("/painel/assinatura");
    }
  },[billingStatus?.accessRestricted,pathname,router,user?.role]);

  if (user && !items.length) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 dark:bg-[#080d18]">
        <section className="max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">Acesso aguardando liberação</p>
          <h1 className="mt-3 text-2xl font-black text-slate-950 dark:text-slate-100">Seu administrador ainda não liberou uma seção para você.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">Assim que ele marcar os acessos no cadastro de funcionários, suas ferramentas aparecerão aqui.</p>
          <button
            onClick={async () => {
              await logout.mutateAsync();
              router.replace("/acesso");
            }}
            className="mt-6 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white"
          >
            Sair da conta
          </button>
        </section>
      </main>
    );
  }

  if (!canAccessCurrentRoute) return null;

  return (
    <div className="app-shell relative isolate min-h-dvh w-full max-w-full overflow-x-hidden bg-[#f6f7f9] text-slate-950 dark:bg-[#080d18] dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden h-dvh w-64 overflow-y-auto bg-slate-950 text-white md:flex md:flex-col">
        <div className="px-4 py-5">
          <Link href={fallbackHref} className="inline-flex">
            <BrandLogo light className="h-9 w-40" />
          </Link>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-400">
              {user?.role === Role.MOTOBOY ? "Central de entregas" : user?.role === Role.GARCOM ? "Operação de salão" : "Gestão da empresa"}
            </p>
            <p className="mt-1 line-clamp-1 text-sm font-bold text-white">{user?.name}</p>
            <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Operação online
            </span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-bold transition-all",
                pathname?.startsWith(item.href)
                  ? "border-brand-500/20 bg-brand-600 text-white shadow-lg shadow-brand-950/20"
                  : "text-slate-400 hover:bg-white/[0.07] hover:text-white",
              )}
            >
              <NavDot active={Boolean(pathname?.startsWith(item.href))} />
              <span>{item.label}</span>
              {item.href === "/painel/pedidos" && (pendingOrders?.count ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-brand-600 px-2 py-0.5 text-xs font-black text-white">
                  {pendingOrders!.count > 99 ? "99+" : pendingOrders!.count}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="p-3">
          <button
            onClick={async () => {
              await logout.mutateAsync();
              router.replace("/acesso");
            }}
            className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-left text-sm font-bold text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
          >
            Sair da conta
          </button>
        </div>
      </aside>
      <div className="min-w-0 max-w-full md:ml-64 md:w-[calc(100%_-_16rem)]">
        <header className="fixed left-0 right-0 top-0 z-30 flex min-h-[61px] w-auto items-center justify-between overflow-hidden border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/90 sm:px-6 md:left-64">
          <div>
            <div className="md:hidden"><BrandLogo adaptive className="h-8 w-36" /></div>
            <p className="hidden text-sm font-black text-slate-900 dark:text-slate-100 md:block">{currentItem?.label ?? "Painel"}</p>
            <p className="hidden text-xs text-slate-500 dark:text-slate-400 md:block">{user?.role === Role.MOTOBOY ? "Suas rotas e entregas" : user?.role === Role.GARCOM ? "Suas mesas e comandas" : "Visão atual da operação"}</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={async () => {
                await logout.mutateAsync();
                router.replace("/acesso");
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-500 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-brand-800 dark:hover:bg-brand-950/40 dark:hover:text-brand-300 md:hidden"
            >
              Sair
            </button>
          </div>
        </header>
        <main className="w-full min-w-0 max-w-full overflow-x-clip px-3 pb-28 pt-[77px] sm:px-6 sm:pt-[85px] md:pb-6 lg:px-8 lg:pt-[93px]">
          {children}
        </main>
      </div>
      <MobileDock items={items.map((item) => ({ ...item, badge: item.href === "/painel/pedidos" ? pendingOrders?.count : 0 }))} pathname={pathname} />
      {user && [Role.ADMIN, Role.FUNCIONARIO].includes(user.role) && pathname !== "/painel/agente" && (
        <NonCriticalBoundary name="assistente operacional">
          <AdminAssistantBubble />
        </NonCriticalBoundary>
      )}
      {/*
        No shell, e não numa página só: a fila de produção atravessa Pedidos e
        Mesas, e o assistente sumir ao trocar de aba quebraria a consulta no
        meio. Motoboy e garçom continuam por página porque o contexto deles é
        da própria tela.
      */}
      {user?.role === Role.COZINHA && (
        <NonCriticalBoundary name="assistente da cozinha">
          <KitchenAssistant />
        </NonCriticalBoundary>
      )}
    </div>
  );
}

function NavDot({ active }: { active: boolean }) {
  return <span className={clsx("h-2 w-2 rounded-full transition", active ? "bg-white dark:bg-slate-900" : "bg-slate-700 group-hover:bg-brand-400")} />;
}
