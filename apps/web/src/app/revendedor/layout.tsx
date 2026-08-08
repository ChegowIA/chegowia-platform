import type { Metadata } from "next";
import { Role } from "@chegowia/shared";
import { RequireRole } from "@/components/auth/require-role";
import { ResellerShell } from "@/components/layout/reseller-shell";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={[Role.REVENDEDOR]}><ResellerShell>{children}</ResellerShell></RequireRole>;
}
