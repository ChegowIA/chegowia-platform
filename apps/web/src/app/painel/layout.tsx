"use client";

import { Role } from "@chegowia/shared";
import { RequireRole } from "@/components/auth/require-role";
import { PainelShell } from "@/components/layout/painel-shell";

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM]}>
      <PainelShell>{children}</PainelShell>
    </RequireRole>
  );
}
