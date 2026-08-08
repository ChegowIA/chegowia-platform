import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ChegowIA — pedidos, delivery e gestão",
    short_name: "ChegowIA",
    description: "Cardápio online, pedidos, delivery, salão e atendimento inteligente.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff7ed",
    theme_color: "#f05a0b",
    lang: "pt-BR",
    icons: [
      {
        src: "/brand/chegowia-favicon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
