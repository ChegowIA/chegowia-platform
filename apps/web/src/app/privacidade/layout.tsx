import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidade",
  description: "Política de privacidade e tratamento de dados da plataforma ChegowIA.",
  alternates: { canonical: "/privacidade" },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
