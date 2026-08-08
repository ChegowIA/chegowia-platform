import type { MetadataRoute } from "next";
import { absoluteSiteUrl, siteOrigin } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/acesso",
        "/cadastro",
        "/login",
        "/recuperar-senha",
        "/redefinir-senha",
        "/verificar-email",
        "/carrinho",
        "/checkout",
        "/contratar/",
        "/minha-conta/",
        "/painel/",
        "/pedido/",
        "/mesa/",
        "/revendedor/",
        "/super-admin/",
        "/busca",
      ],
    },
    sitemap: absoluteSiteUrl("/sitemap.xml"),
    host: siteOrigin,
  };
}
