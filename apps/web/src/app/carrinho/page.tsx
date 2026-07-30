"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cartSubtotal, useCartStore } from "@/lib/cart-store";
import { formatCurrency } from "@/lib/format";
import { PublicHeader } from "@/components/layout/public-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function CartPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const companySlug = useCartStore((s) => s.companySlug);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const subtotal = cartSubtotal(items);

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-50">Seu carrinho</h1>

        {items.length === 0 ? (
          <Card>
            <CardContent className="space-y-4 py-10 text-center">
              <p className="text-slate-500">Seu carrinho está vazio.</p>
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
                      {item.variationName && <p className="text-sm text-slate-500">{item.variationName}</p>}
                      {item.addonsLabel && <p className="text-sm text-slate-500">+ {item.addonsLabel}</p>}
                      {item.notes && <p className="text-sm italic text-slate-400">Obs: {item.notes}</p>}
                      <p className="mt-1 text-sm text-slate-500">{formatCurrency(item.unitPrice)} un.</p>
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
                      <button onClick={() => removeItem(item.key)} className="text-xs text-red-600 hover:underline">
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
