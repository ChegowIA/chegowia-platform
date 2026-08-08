import type { Metadata } from "next";

// O endereço contém uma credencial opaca da mesa. Ele é próprio para o QR
// físico, não para mecanismos de busca nem páginas de navegação pública.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function TableQrLayout({ children }: { children: React.ReactNode }) {
  return children;
}
