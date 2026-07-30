"use client";

import { Role } from "@chegowia/shared";
import { RequireRole } from "@/components/auth/require-role";
import { SuperAdminShell } from "@/components/layout/super-admin-shell";

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.SUPER_ADMIN]}>
      <SuperAdminShell>{children}</SuperAdminShell>
    </RequireRole>
  );
}
