import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { Company, MarketplaceProduct } from "@/lib/types";
import { ProductImage } from "@/components/catalog/product-image";

/**
 * Cards do marketplace. Extraídos de app/page.tsx porque a página de busca
 * (/busca) precisa exatamente da mesma apresentação — produto mostrando de qual
 * loja veio, já que fora do contexto de uma loja essa informação é essencial.
 *
 * O `block` no Link é obrigatório: <a> é inline por padrão, e um inline com
 * border-radius que quebra em várias linhas tem a borda fragmentada pelo
 * navegador, virando dois arcos soltos em vez de um retângulo. Como item direto
 * de um grid isso não aparece (itens de grid são blockificados), mas basta
 * envolver o card em qualquer wrapper para o defeito voltar.
 */
export function MarketplaceProductCard({
  product,
  compact = false,
}: {
  product: MarketplaceProduct;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/loja/${product.company.slug}`}
      className="group block rounded-2xl border border-slate-200 bg-white p-3 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift dark:bg-slate-900 dark:border-slate-800"
    >
      <ProductImage src={product.imageUrl} alt={product.name} className={compact ? "h-32 w-full" : "h-36 w-full"} />
      <div className="pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
            {product.publicType.name}
          </span>
          {product.isFeatured && (
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-bold text-accent-800 dark:bg-accent-950/30 dark:text-accent-300">
              Destaque
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 min-h-10 font-black text-slate-950 group-hover:text-brand-700 dark:text-slate-100">{product.name}</h3>
        {product.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{product.description}</p>}
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-lg font-black text-brand-700 dark:text-brand-300">{formatCurrency(Number(product.price))}</p>
            <p className="line-clamp-1 text-xs text-slate-400 dark:text-slate-500">{product.company.name}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {product.company.avgDeliveryTimeMinutes} min
          </span>
        </div>
      </div>
    </Link>
  );
}

export function MarketplaceCompanyCard({ company }: { company: Company }) {
  return (
    <Link
      href={`/loja/${company.slug}`}
      className="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift dark:bg-slate-900 dark:border-slate-800"
    >
      <div className="flex items-start gap-3">
        <ProductImage src={company.logoUrl} alt={company.name} className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-lg font-bold text-slate-950 group-hover:text-brand-700 dark:text-slate-100">{company.name}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {company.city}
            {company.state ? ` - ${company.state}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
              {formatCurrency(company.deliveryFeeBase)}
            </span>
            <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-800 dark:bg-accent-950/30 dark:text-accent-300">
              {company.avgDeliveryTimeMinutes} min
            </span>
          </div>
          <p className="mt-3 line-clamp-1 text-xs text-slate-400 dark:text-slate-500">
            Raio de entrega: {Number(company.deliveryRadiusKm).toFixed(1)} km · taxa calculada pela rota
          </p>
        </div>
      </div>
    </Link>
  );
}
