"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Role } from "@chegowia/shared";
import { cartSubtotal, useCartStore } from "@/lib/cart-store";
import { useAuthStore } from "@/lib/auth-store";
import { homePathForRole } from "@/lib/auth-routes";
import { formatCurrency } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function CartPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
  const items = useCartStore((s) => s.items);
  const companySlug = useCartStore((s) => s.companySlug);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const subtotal = cartSubtotal(items);

  if (hasHydrated && !isSessionLoading && user && user.role !== Role.CLIENTE) {
    return <><PublicHeader /><main className="mx-auto grid min-h-[calc(100vh-70px)] max-w-3xl place-items-center px-4 py-12"><Card><CardContent className="p-8 text-center sm:p-10"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-2xl text-brand-700 dark:bg-brand-950/30 dark:text-brand-300">↔</div><h1 className="mt-5 text-2xl font-black">Carrinho exclusivo para clientes</h1><p className="mx-auto mt-3 max-w-lg leading-7 text-slate-500 dark:text-slate-400">Você está usando um perfil profissional. Separe sua atividade de trabalho dos pedidos pessoais entrando em uma conta de cliente.</p><div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/acesso?trocar-conta=cliente"><Button>Entrar como cliente</Button></Link><Link href="/acesso?trocar-conta=cliente&modo=cadastro"><Button variant="outline">Criar conta cliente</Button></Link><Link href={homePathForRole(user.role)}><Button variant="ghost">Voltar ao painel</Button></Link></div></CardContent></Card></main></>;
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-50">Seu carrinho</h1>

        {items.length === 0 ? (
          <Card>
            <CardContent className="space-y-4 py-10 text-center">
              <p className="text-slate-500 dark:text-slate-400">Seu carrinho está vazio.</p>
              <Link href="/" className="font-medium text-brand-600 hover:underline">
                Voltar para a home
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {companySlug && (
              <Link href={`/loja/${companySlug}`} className="text-sm font-medium text-brand-600 hover:underline">
                + Adicionar mais itens
              </Link>
            )}

            <Card>
              <CardContent className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((item) => (
                  <div key={item.key} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{item.name}</p>
                      {item.variationName && <p className="text-sm text-slate-500 dark:text-slate-400">{item.variationName}</p>}
                      {item.addonsLabel && <p className="text-sm text-slate-500 dark:text-slate-400">+ {item.addonsLabel}</p>}
                      {item.optionSelectionsLabel && <p className="text-sm text-slate-500 dark:text-slate-400">{item.optionSelectionsLabel}</p>}
                      {item.notes && <p className="text-sm italic text-slate-400">Obs: {item.notes}</p>}
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatCurrency(item.unitPrice)} un.</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQuantity(item.key, item.quantity - 1)}
                          className="h-7 w-7 rounded-full border border-slate-300 dark:border-slate-700"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.key, item.quantity + 1)}
                          className="h-7 w-7 rounded-full border border-slate-300 dark:border-slate-700"
                        >
                          +
                        </button>
                      </div>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </span>
                      <button onClick={() => removeItem(item.key)} className="text-xs text-red-600 hover:underline dark:text-red-400">
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center justify-between">
                <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">Total</span>
                <span className="text-lg font-bold text-brand-700 dark:text-brand-400">{formatCurrency(subtotal)}</span>
              </CardContent>
            </Card>

            <Button className="w-full" size="lg" onClick={() => router.push("/checkout")}>
              Ir para checkout
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
