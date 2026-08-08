import type { Metadata } from "next";

const title = "Planos para gestão de pedidos e delivery";
const description = "Conheça o plano ChegowIA para organizar pedidos, delivery, salão e atendimento. Teste tudo gratuitamente por 7 dias.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/planos" },
  openGraph: { type: "website", url: "/planos", title, description, images: ["/landing/restaurant-operation-hero.png"] },
  twitter: { card: "summary_large_image", title, description, images: ["/landing/restaurant-operation-hero.png"] },
};

export default function PlansLayout({ children }: { children: React.ReactNode }) {
  return children;
}
