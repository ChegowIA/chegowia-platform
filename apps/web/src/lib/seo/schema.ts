import type { Category, Company, Product } from "@/lib/types";
import { absoluteAssetUrl, absoluteSiteUrl } from "./site";
import { PublicMenuResponse, PublicProductDetail } from "./public-catalog";

type JsonRecord = Record<string, unknown>;

const WEEKDAY: Record<string, string> = {
  domingo: "Sunday",
  segunda: "Monday",
  "segunda-feira": "Monday",
  terca: "Tuesday",
  "terça": "Tuesday",
  "terca-feira": "Tuesday",
  "terça-feira": "Tuesday",
  quarta: "Wednesday",
  "quarta-feira": "Wednesday",
  quinta: "Thursday",
  "quinta-feira": "Thursday",
  sexta: "Friday",
  "sexta-feira": "Friday",
  sabado: "Saturday",
  "sábado": "Saturday",
};

function compact<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  ) as T;
}

function plainText(value: string | null | undefined, fallback: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function money(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function openingHoursSpecification(openingHours?: Record<string, string> | null) {
  if (!openingHours) return undefined;

  const specs = Object.entries(openingHours).flatMap(([day, schedule]) => {
    const weekday = WEEKDAY[day.trim().toLocaleLowerCase("pt-BR")];
    const match = schedule?.trim().match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
    if (!weekday || !match) return [];
    return [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${weekday}`,
      opens: match[1],
      closes: match[2],
    }];
  });

  return specs.length ? specs : undefined;
}

function storeAddress(company: Company) {
  const hasAddress = Boolean(company.addressLine || company.city || company.state);
  if (!hasAddress) return undefined;

  return compact({
    "@type": "PostalAddress",
    streetAddress: company.addressLine,
    addressLocality: company.city,
    addressRegion: company.state,
    addressCountry: "BR",
  });
}

function productUrl(slug: string, id: string) {
  return absoluteSiteUrl(`/loja/${encodeURIComponent(slug)}/produto/${encodeURIComponent(id)}`);
}

function menuItem(product: Product, companySlug: string) {
  return compact({
    "@type": "MenuItem",
    name: product.name,
    description: product.description ?? undefined,
    url: productUrl(companySlug, product.id),
    image: absoluteAssetUrl(product.imageUrl),
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: money(product.price),
      availability: "https://schema.org/InStock",
      url: productUrl(companySlug, product.id),
    },
  });
}

export function platformSchema() {
  const homepage = absoluteSiteUrl("/");
  const logo = absoluteSiteUrl("/brand/chegowia-logo.png");

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${homepage}#organization`,
        name: "ChegowIA",
        alternateName: ["Chegow IA", "Chegowia"],
        description: "Plataforma brasileira para pedidos, delivery, salão, cardápio online e atendimento com inteligência artificial.",
        url: homepage,
        logo,
      },
      {
        "@type": "WebSite",
        "@id": `${homepage}#website`,
        url: homepage,
        name: "ChegowIA",
        alternateName: ["Chegow IA", "Chegowia"],
        description: "Software de pedidos, delivery, salão e gestão para restaurantes.",
        inLanguage: "pt-BR",
        publisher: { "@id": `${homepage}#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${absoluteSiteUrl("/busca")}?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

export function storeSchema(store: { company: Company; menu: PublicMenuResponse }) {
  const { company, menu } = store;
  const storeUrl = absoluteSiteUrl(`/loja/${encodeURIComponent(company.slug)}`);
  const logo = absoluteAssetUrl(company.logoUrl) ?? absoluteSiteUrl("/brand/chegowia-mark.png");
  const location = [company.city, company.state].filter(Boolean).join(", ");

  const business = compact({
    "@type": "FoodEstablishment",
    "@id": `${storeUrl}#business`,
    name: company.name,
    description: `${company.name}${location ? ` em ${location}` : ""}. Cardápio online e pedidos.`,
    url: storeUrl,
    image: logo,
    logo,
    address: storeAddress(company),
    hasMenu: { "@id": `${storeUrl}#menu` },
    openingHoursSpecification: openingHoursSpecification(company.settings?.openingHours),
  });

  const menuSchema = {
    "@type": "Menu",
    "@id": `${storeUrl}#menu`,
    name: `Cardápio de ${company.name}`,
    url: storeUrl,
    hasMenuSection: menu.categories
      .filter((category) => (category.products?.length ?? 0) > 0)
      .map((category: Category) => compact({
        "@type": "MenuSection",
        name: category.name,
        description: category.description ?? undefined,
        hasMenuItem: (category.products ?? []).map((product) => menuItem(product, company.slug)),
      })),
  };

  return {
    "@context": "https://schema.org",
    "@graph": [business, menuSchema],
  };
}

export function productSchema(detail: PublicProductDetail) {
  const { company, category, product } = detail;
  const url = productUrl(company.slug, product.id);
  const image = absoluteAssetUrl(product.imageUrl) ?? absoluteAssetUrl(company.logoUrl);

  return compact({
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: plainText(product.description, `${product.name} no cardápio de ${company.name}.`),
    image,
    sku: product.id,
    category: category.name,
    brand: { "@type": "Brand", name: company.name },
    url,
    mainEntityOfPage: url,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: money(product.price),
      availability: "https://schema.org/InStock",
      url,
      seller: { "@id": `${absoluteSiteUrl(`/loja/${encodeURIComponent(company.slug)}`)}#business` },
    },
  });
}
