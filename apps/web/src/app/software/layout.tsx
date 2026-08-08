import type { Metadata } from "next";

const title = "Sistema para restaurantes, delivery e salão";
const description = "Centralize cardápio online, pedidos, delivery, mesas, equipe e atendimento inteligente no ChegowIA.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/software" },
  openGraph: { type: "website", url: "/software", title, description, images: ["/landing/restaurant-operation-hero.png"] },
  twitter: { card: "summary_large_image", title, description, images: ["/landing/restaurant-operation-hero.png"] },
};

export default function SoftwareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
