"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { useAuthStore } from "@/lib/auth-store";
import { useLogout } from "@/lib/use-auth";

const NAV_ITEMS = [
  { href: "/super-admin/dashboard", label: "Dashboard" },
  { href: "/super-admin/empresas", label: "Empresas" },
  { href: "/super-admin/relatorios", label: "Relatórios globais" },
];

export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white md:block">
        <div className="flex items-center gap-2 px-5 py-5 text-lg font-bold text-slate-950">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white shadow-sm">
            C
          </span>
          <span>ChegowIA Admin</span>
        </div>
        <nav className="space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "block rounded-lg border border-transparent px-3 py-2 text-sm font-medium transition-colors",
                pathname?.startsWith(item.href)
                  ? "border-brand-200 bg-brand-50 text-brand-700 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{user?.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Operação da plataforma</p>
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
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
