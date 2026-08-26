import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/json-ld";
import { PublicHeader } from "@/components/layout/public-header";
import { getPublicProduct } from "@/lib/seo/public-catalog";
import { productSchema } from "@/lib/seo/schema";
import { absoluteAssetUrl, absoluteSiteUrl } from "@/lib/seo/site";

type ProductRouteProps = {
  params: Promise<{ slug: string; productId: string }>;
};

function currency(value: number | string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function concise(value: string, limit = 155) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: ProductRouteProps): Promise<Metadata> {
  const { slug, productId } = await params;
  const detail = await getPublicProduct(slug, productId);

  if (!detail) {
    return {
      title: "Produto não encontrado",
      robots: { index: false, follow: false },
    };
  }

  const { company, category, product } = detail;
  const title = `${product.name} — ${company.name}`;
  const description = concise(
    product.description?.trim() || `${product.name} no cardápio de ${company.name}. Peça online de forma rápida e segura.`,
  );
  const canonical = `/loja/${encodeURIComponent(company.slug)}/produto/${encodeURIComponent(product.id)}`;
  const image = absoluteAssetUrl(product.imageUrl)
    ?? absoluteAssetUrl(company.logoUrl)
    ?? absoluteSiteUrl("/landing/restaurant-table-service-v2.png");

  return {
    title,
    description,
    keywords: [product.name, category.name, company.name, company.city, company.state]
      .filter((value): value is string => Boolean(value)),
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      url: canonical,
      siteName: "ChegowIA",
      title,
      description,
      images: [{ url: image, alt: `${product.name} — ${company.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function PublicProductPage({ params }: ProductRouteProps) {
  const { slug, productId } = await params;
  const detail = await getPublicProduct(slug, productId);
  if (!detail) notFound();

  const { company, category, product } = detail;
  const image = absoluteAssetUrl(product.imageUrl);
  const storeUrl = `/loja/${encodeURIComponent(company.slug)}`;
  const optionGroups = product.optionGroups ?? [];

  return (
    <>
      <JsonLd data={productSchema(detail)} />
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <nav aria-label="Navegação estrutural" className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Link href="/" className="transition hover:text-brand-700 dark:hover:text-brand-300">Início</Link>
          <span aria-hidden="true">/</span>
          <Link href={storeUrl} className="transition hover:text-brand-700 dark:hover:text-brand-300">{company.name}</Link>
          <span aria-hidden="true">/</span>
          <span className="text-slate-700 dark:text-slate-200">{product.name}</span>
        </nav>

        <article className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_28px_80px_-42px_rgba(15,23,42,.45)] dark:border-slate-800 dark:bg-slate-900">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(330px,.85fr)]">
            <div className="relative min-h-72 bg-gradient-to-br from-brand-50 via-white to-accent-50 dark:from-brand-950/30 dark:via-slate-900 dark:to-accent-950/20">
              {image ? (
                // O endereço vem de upload público validado pela API.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={product.name} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="grid h-full min-h-72 place-items-center p-8 text-center text-5xl font-black text-brand-700 dark:text-brand-300" aria-label={product.name}>
                  {product.name.trim().charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="p-6 sm:p-8">
              <p className="text-xs font-black uppercase tracking-[.16em] text-brand-700 dark:text-brand-300">{category.name}</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl dark:text-slate-50">{product.name}</h1>
              {product.description && <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">{product.description}</p>}
              <p className="mt-6 text-3xl font-black tracking-tight text-slate-950 dark:text-slate-50">{currency(product.price)}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Preço inicial; opções e adicionais podem alterar o total.</p>

              {(product.variations.length > 0 || product.addons.length > 0 || optionGroups.length > 0) && (
                <section className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40" aria-label="Opções disponíveis">
                  <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">Opções disponíveis no pedido</h2>
                  {optionGroups.length > 0 && (
                    <div className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {optionGroups.map((group) => (
                        <p key={group.id}>
                          <span className="font-bold">{group.name}:</span> {(group.options ?? []).map((option) => option.name).join(", ")}
                          {group.minSelections > 0 ? ` · escolha de ${group.minSelections} a ${group.maxSelections}` : ` · até ${group.maxSelections}`}
                        </p>
                      ))}
                    </div>
                  )}
                  {product.variations.length > 0 && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-bold">Variações:</span> {product.variations.map((variation) => variation.name).join(", ")}
                    </p>
                  )}
                  {product.addons.length > 0 && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-bold">Adicionais:</span> {product.addons.map((addon) => addon.name).join(", ")}
                    </p>
                  )}
                </section>
              )}

              <Link
                href={storeUrl}
                className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-5 text-sm font-black text-white shadow-[0_16px_34px_-18px_rgba(234,88,12,.85)] transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:w-auto"
              >
                Ver cardápio e pedir
              </Link>
            </div>
          </div>
        </article>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-black text-slate-900 dark:text-slate-100">Pedido direto com {company.name}</p>
          <p className="mt-1">Confira disponibilidade, personalize o item e conclua seu pedido no cardápio oficial da loja.</p>
        </section>
      </main>
    </>
  );
}
