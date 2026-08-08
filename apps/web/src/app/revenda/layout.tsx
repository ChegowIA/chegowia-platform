import type { Metadata } from "next";

const title = "Programa de revendedores ChegowIA";
const description = "Indique empresas, acompanhe leads e receba comissão recorrente no programa de parceiros ChegowIA.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/revenda" },
  openGraph: { type: "website", url: "/revenda", title, description, images: ["/landing/restaurant-operation-hero.png"] },
  twitter: { card: "summary_large_image", title, description, images: ["/landing/restaurant-operation-hero.png"] },
};

export default function ResaleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
