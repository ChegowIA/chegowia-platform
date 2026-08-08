import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";
import { SessionBootstrap } from "@/components/auth/session-bootstrap";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { JsonLd } from "@/components/seo/json-ld";
import { platformSchema } from "@/lib/seo/schema";
import { siteOrigin } from "@/lib/seo/site";

/**
 * Roda antes do primeiro paint para evitar flash do tema errado. Precisa ser
 * síncrono e sem imports, por isso duplica a lógica de `resolveTheme`/
 * `applyTheme` de lib/theme-store.ts — ao mudar a chave ou o formato do
 * persist do Zustand, atualize os dois lugares.
 */
const THEME_INIT_SCRIPT = `(function(){try{var p="system";var raw=localStorage.getItem("chegowia-theme");if(raw){var s=JSON.parse(raw);if(s&&s.state&&s.state.preference)p=s.state.preference;}var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: "ChegowIA — Pedidos, delivery e gestão para restaurantes",
    template: "%s | ChegowIA",
  },
  // A raiz é a URL preferida da marca. Sem este sinal explícito, o Google
  // precisa escolher sozinho entre o domínio principal, parâmetros e URLs
  // alternativas que venha a encontrar.
  alternates: { canonical: "/" },
  description: "ChegowIA conecta cardápio online, pedidos, delivery, salão, equipe e atendimento inteligente em uma só operação.",
  applicationName: "ChegowIA",
  category: "Tecnologia para restaurantes e delivery",
  keywords: [
    "sistema para delivery",
    "cardápio online",
    "gestão de restaurante",
    "pedidos por WhatsApp",
    "atendimento com IA",
    "ChegowIA",
  ],
  authors: [{ name: "ChegowIA" }],
  creator: "ChegowIA",
  publisher: "ChegowIA",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "ChegowIA",
    title: "ChegowIA — Pedidos, delivery e gestão para restaurantes",
    description: "Cardápio online, pedidos, delivery, salão e atendimento inteligente em uma só operação.",
    images: [{
      url: "/landing/restaurant-operation-hero.png",
      width: 1200,
      height: 630,
      alt: "ChegowIA — gestão moderna para restaurantes e delivery",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ChegowIA — Pedidos, delivery e gestão para restaurantes",
    description: "Cardápio online, pedidos, delivery, salão e atendimento inteligente em uma só operação.",
    images: ["/landing/restaurant-operation-hero.png"],
  },
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
  icons: {
    // Mantemos a versão PNG grande para Google, navegadores atuais e PWA e
    // disponibilizamos também /favicon.ico para clientes legados que procuram
    // o caminho convencional diretamente.
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/chegowia-favicon.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/brand/chegowia-favicon.png", type: "image/png", sizes: "512x512" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff7ed" },
    { media: "(prefers-color-scheme: dark)", color: "#080d18" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: o script acima altera className/style do <html>
    // antes da hidratação, o que o React sinalizaria como divergência.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <JsonLd data={platformSchema()} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <QueryProvider>
          <ThemeProvider>
            <SessionBootstrap>{children}</SessionBootstrap>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
