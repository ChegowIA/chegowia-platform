import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { getPublicStore } from "@/lib/seo/public-catalog";
import { storeSchema } from "@/lib/seo/schema";
import { absoluteAssetUrl, absoluteSiteUrl } from "@/lib/seo/site";

type StoreRouteProps = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

function locationLabel(city?: string | null, state?: string | null) {
  return [city, state].filter(Boolean).join(", ");
}

function concise(value: string, limit = 155) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: Omit<StoreRouteProps, "children">): Promise<Metadata> {
  const { slug } = await params;
  const store = await getPublicStore(slug);

  if (!store) {
    return {
      title: "Loja não encontrada",
      robots: { index: false, follow: false },
    };
  }

  const { company, menu } = store;
  const location = locationLabel(company.city, company.state);
  const categoryNames = menu.categories
    .filter((category) => (category.products?.length ?? 0) > 0)
    .map((category) => category.name)
    .slice(0, 4);
  const productNames = menu.categories
    .flatMap((category) => category.products ?? [])
    .map((product) => product.name)
    .slice(0, 5);
  const title = `${company.name}${location ? ` em ${location}` : ""} — Cardápio e pedidos`;
  const description = concise(
    `${company.name}${location ? ` em ${location}` : ""}. Veja o cardápio online${categoryNames.length ? `, incluindo ${categoryNames.join(", ")}` : ""}, e faça seu pedido.`,
  );
  const canonical = `/loja/${encodeURIComponent(company.slug)}`;
  const image = absoluteAssetUrl(company.logoUrl) ?? absoluteSiteUrl("/landing/restaurant-table-service-v2.png");

  return {
    title,
    description,
    keywords: [company.name, location, ...categoryNames, ...productNames].filter(Boolean),
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      url: canonical,
      siteName: "ChegowIA",
      title,
      description,
      images: [{ url: image, alt: `Cardápio online de ${company.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

/**
 * A vitrine continua interativa no client, enquanto este layout entrega para
 * robôs um documento estável, canônico e com Menu/LocalBusiness gerado a
 * partir do catálogo real da empresa.
 */
export default async function PublicStoreLayout({ children, params }: StoreRouteProps) {
  const { slug } = await params;
  const store = await getPublicStore(slug);

  return (
    <>
      {store && <JsonLd data={storeSchema(store)} />}
      {children}
    </>
  );
}
