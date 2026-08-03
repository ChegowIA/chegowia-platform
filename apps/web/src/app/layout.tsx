import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";
import { SessionBootstrap } from "@/components/auth/session-bootstrap";
import { ThemeProvider } from "@/components/theme/theme-provider";

/**
 * Roda antes do primeiro paint para evitar flash do tema errado. Precisa ser
 * síncrono e sem imports, por isso duplica a lógica de `resolveTheme`/
 * `applyTheme` de lib/theme-store.ts — ao mudar a chave ou o formato do
 * persist do Zustand, atualize os dois lugares.
 */
const THEME_INIT_SCRIPT = `(function(){try{var p="system";var raw=localStorage.getItem("chegowia-theme");if(raw){var s=JSON.parse(raw);if(s&&s.state&&s.state.preference)p=s.state.preference;}var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

export const metadata: Metadata = {
  title: "ChegowIA — Delivery, salão e gestão em tempo real",
  description: "Plataforma para pedidos, delivery, salão, equipe, clientes e inteligência operacional.",
  icons: {
    icon: "/brand/chegowia-favicon.png",
    shortcut: "/brand/chegowia-favicon.png",
    apple: "/brand/chegowia-favicon.png",
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
