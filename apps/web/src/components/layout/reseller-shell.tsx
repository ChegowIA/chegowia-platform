"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { BrandLogo } from "@/components/brand/brand-logo";
import { useAuthStore } from "@/lib/auth-store";
import { useLogout } from "@/lib/use-auth";
import { LiveLeadOffer } from "@/components/resellers/live-lead-offer";
import { MobileDock } from "@/components/layout/mobile-dock";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ResellerAssistant } from "@/components/ai/reseller-assistant";

const ITEMS = [
  { href: "/revendedor/dashboard", label: "Visão geral" },
  { href: "/revendedor/clientes", label: "Clientes e vendas" },
  { href: "/revendedor/financeiro", label: "Financeiro" },
];

export function ResellerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();
  return (
    <div className="app-shell flex min-h-screen bg-[#f5f6f8] text-slate-950 dark:bg-[#080d18] dark:text-slate-100">
      <aside className="sticky top-0 hidden h-dvh self-start w-64 shrink-0 flex-col overflow-y-auto bg-slate-950 text-white md:flex">
        <div className="p-4 pt-5">
          <Link href="/revendedor/dashboard" className="inline-flex"><BrandLogo light className="h-9 w-40" /></Link>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-brand-400">Parceiro ChegowIA</p>
            <p className="mt-1 truncate text-sm font-bold">{user?.name}</p>
            <p className="mt-2 text-[11px] text-emerald-300">● Central comercial online</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {ITEMS.map((item) => <Link key={item.href} href={item.href} className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition", pathname?.startsWith(item.href) ? "bg-brand-600 text-white shadow-lg" : "text-slate-400 hover:bg-white/[.07] hover:text-white")}><span className="h-2 w-2 rounded-full bg-current" />{item.label}</Link>)}
        </nav>
        <div className="m-3 flex items-center gap-2"><ThemeToggle tone="onDark" /><button onClick={async()=>{await logout.mutateAsync();router.replace("/acesso")}} className="flex-1 rounded-xl border border-white/10 px-3 py-2.5 text-left text-sm font-bold text-slate-400 hover:bg-white/[.07]">Sair</button></div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 md:hidden">
          <BrandLogo adaptive className="h-8 w-36" />
          <div className="flex items-center gap-2">
            <span className="hidden max-w-28 truncate rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 min-[390px]:inline-flex">● Online</span>
            <ThemeToggle />
            <button
              type="button"
              disabled={logout.isPending}
              onClick={async () => {
                try { await logout.mutateAsync(); } finally { router.replace("/acesso"); }
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-800 dark:hover:bg-brand-950/40 dark:hover:text-brand-300"
            >
              {logout.isPending ? "Saindo..." : "Sair"}
            </button>
          </div>
        </header>
        <main className="min-w-0 overflow-x-hidden px-3 pb-28 pt-4 sm:p-6 md:pb-6 lg:p-8">{children}</main>
      </div>
      <MobileDock items={ITEMS} pathname={pathname} />
      <LiveLeadOffer />
      <ResellerAssistant />
    </div>
  );
}
