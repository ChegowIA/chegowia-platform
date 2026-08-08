const DEFAULT_SITE_URL = "https://chegowia.com.br";
const DEFAULT_API_URL = "http://localhost:3001";

function originFrom(value: string | undefined, fallback: string) {
  if (!value) return fallback;

  try {
    return new URL(value).origin;
  } catch {
    return fallback;
  }
}

/**
 * Endereço canônico da aplicação pública. Em produção, configure
 * NEXT_PUBLIC_SITE_URL com o domínio final; o fallback evita que metadados
 * gerados no build apontem para localhost por acidente.
 */
export const siteOrigin = originFrom(
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL,
  DEFAULT_SITE_URL,
);

/**
 * A origem da API é usada apenas no servidor para buscar catálogo e para
 * transformar imagens de upload em URLs absolutas para buscadores/redes.
 * API_INTERNAL_URL permite apontar para a rede privada em deploy.
 */
export const apiOrigin = originFrom(
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL,
  DEFAULT_API_URL,
);

export function absoluteSiteUrl(path = "/") {
  return new URL(path, `${siteOrigin}/`).toString();
}

export function absoluteAssetUrl(path?: string | null) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path.startsWith("/") ? path : `/${path}`, `${apiOrigin}/`).toString();
}

export function asIsoDate(value: string | Date | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
