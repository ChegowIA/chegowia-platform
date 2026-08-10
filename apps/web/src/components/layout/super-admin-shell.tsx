"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { useAuthStore } from "@/lib/auth-store";
import { useLogout } from "@/lib/use-auth";
import { BrandLogo } from "@/components/brand/brand-logo";
import { MobileDock } from "@/components/layout/mobile-dock";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const NAV_ITEMS = [
  { href: "/super-admin/dashboard", label: "Dashboard" },
  { href: "/super-admin/empresas", label: "Empresas" },
  { href: "/super-admin/aprovacoes", label: "Aprovações" },
  { href: "/super-admin/planos", label: "Planos e billing" },
  { href: "/super-admin/operacao", label: "Saúde operacional" },
  { href: "/super-admin/atendimento", label: "Atendimento ChegowIA" },
  { href: "/super-admin/relatorios", label: "Relatórios globais" },
];

export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();

  return (
    <div className="app-shell flex min-h-screen bg-[#f6f7f9] text-slate-950 dark:bg-[#080d18] dark:text-slate-100">
      <aside className="hidden w-64 shrink-0 bg-slate-950 text-white md:flex md:flex-col">
        <div className="px-4 py-5">
          <Link href="/super-admin/dashboard" className="inline-flex">
            <BrandLogo light className="h-9 w-40" />
          </Link>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-400">Controle da plataforma</p>
            <p className="mt-1 text-sm font-bold text-white">{user?.name}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-bold transition-all",
                pathname?.startsWith(item.href)
                  ? "border-brand-500/20 bg-brand-600 text-white shadow-lg"
                  : "text-slate-400 hover:bg-white/[0.07] hover:text-white",
              )}
            >
              <span className={clsx("h-2 w-2 rounded-full", pathname?.startsWith(item.href) ? "bg-white dark:bg-slate-900" : "bg-slate-700")} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3">
          <button
            onClick={async () => {
              await logout.mutateAsync();
              router.replace("/acesso");
            }}
            className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-left text-sm font-bold text-slate-400 hover:bg-white/[0.07] hover:text-white"
          >
            Sair da conta
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/90 sm:px-6">
          <div>
            <div className="md:hidden"><BrandLogo adaptive className="h-8 w-36" /></div>
            <p className="hidden text-sm font-black text-slate-900 dark:text-slate-100 md:block">ChegowIA Platform</p>
            <p className="hidden text-xs text-slate-500 dark:text-slate-400 md:block">Visão global da operação</p>
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
        <main className="min-w-0 overflow-x-hidden px-3 pb-28 pt-4 sm:p-6 md:pb-6 lg:p-8">{children}</main>
      </div>
      <MobileDock items={NAV_ITEMS} pathname={pathname} />
    </div>
  );
}
