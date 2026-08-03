import { Role } from "@chegowia/shared";
import { RequireRole } from "@/components/auth/require-role";
import { ResellerShell } from "@/components/layout/reseller-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={[Role.REVENDEDOR]}><ResellerShell>{children}</ResellerShell></RequireRole>;
}
