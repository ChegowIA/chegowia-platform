import type { Category, Company, Product } from "@/lib/types";
import { apiOrigin } from "./site";

export interface PublicMenuResponse {
  company: Pick<Company, "id" | "name" | "slug">;
  categories: Category[];
}

export interface PublicProductDetail {
  company: Pick<
    Company,
    | "id"
    | "name"
    | "slug"
    | "addressLine"
    | "city"
    | "state"
    | "logoUrl"
    | "deliveryFeeBase"
    | "deliveryRadiusKm"
    | "avgDeliveryTimeMinutes"
  > & {
    settings?: Pick<NonNullable<Company["settings"]>, "openingHours"> | null;
  };
  category: Pick<Category, "id" | "name" | "description">;
  product: Product & { updatedAt?: string };
}

export interface PublicSitemapResponse {
  companies: Array<{
    slug: string;
    updatedAt: string;
    products: Array<{ id: string; updatedAt: string }>;
  }>;
}

async function fetchPublic<T>(path: string, revalidate = 300): Promise<T | null> {
  try {
    const response = await fetch(`${apiOrigin}/api${path}`, {
      headers: { Accept: "application/json" },
      next: { revalidate },
    });

    if (!response.ok) return null;
    return response.json() as Promise<T>;
  } catch {
    // SEO não pode derrubar a página pública caso a API esteja reiniciando.
    // O próximo ciclo de revalidação tenta novamente.
    return null;
  }
}

export async function getPublicStore(slug: string) {
  const encodedSlug = encodeURIComponent(slug);
  const [company, menu] = await Promise.all([
    fetchPublic<Company>(`/companies/public/${encodedSlug}`),
    fetchPublic<PublicMenuResponse>(`/catalog/public/${encodedSlug}`),
  ]);

  if (!company || !menu) return null;
  return { company, menu };
}

export async function getPublicProduct(slug: string, productId: string) {
  return fetchPublic<PublicProductDetail>(
    `/catalog/public/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}`,
  );
}

export async function getPublicSitemap() {
  return fetchPublic<PublicSitemapResponse>("/catalog/public/sitemap", 3600);
}
