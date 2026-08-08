import type { MetadataRoute } from "next";
import { getPublicSitemap } from "@/lib/seo/public-catalog";
import { absoluteSiteUrl, asIsoDate } from "@/lib/seo/site";

export const revalidate = 3600;

const marketingPages: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/planos", changeFrequency: "weekly", priority: 0.8 },
  { path: "/revenda", changeFrequency: "monthly", priority: 0.6 },
  { path: "/termos", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacidade", changeFrequency: "yearly", priority: 0.2 },
];

/**
 * Sitemap orientado por conteúdo público real. Empresa inativa, categoria
 * desativada ou produto desativado deixam de aparecer na próxima revalidação.
 * Se a API estiver indisponível durante um deploy, preservamos ao menos as
 * páginas institucionais em vez de tornar o build frágil.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const generatedAt = new Date();
  const entries: MetadataRoute.Sitemap = marketingPages.map((page) => ({
    url: absoluteSiteUrl(page.path),
    lastModified: generatedAt,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
  const publicCatalog = await getPublicSitemap();

  for (const company of publicCatalog?.companies ?? []) {
    entries.push({
      url: absoluteSiteUrl(`/loja/${encodeURIComponent(company.slug)}`),
      lastModified: asIsoDate(company.updatedAt) ?? generatedAt,
      changeFrequency: "daily",
      priority: 0.9,
    });

    for (const product of company.products) {
      entries.push({
        url: absoluteSiteUrl(
          `/loja/${encodeURIComponent(company.slug)}/produto/${encodeURIComponent(product.id)}`,
        ),
        lastModified: asIsoDate(product.updatedAt) ?? asIsoDate(company.updatedAt) ?? generatedAt,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  return entries;
}
