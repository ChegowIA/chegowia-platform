import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de uso",
  description: "Termos de uso da plataforma ChegowIA.",
  alternates: { canonical: "/termos" },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
