import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";
import { SessionBootstrap } from "@/components/auth/session-bootstrap";

export const metadata: Metadata = {
  title: "ChegowIA — Gestão de Pedidos e Delivery",
  description: "Plataforma SaaS multiempresa de pedidos/delivery com agente de IA integrado.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen font-sans antialiased">
        <QueryProvider>
          <SessionBootstrap>{children}</SessionBootstrap>
        </QueryProvider>
      </body>
    </html>
  );
}
