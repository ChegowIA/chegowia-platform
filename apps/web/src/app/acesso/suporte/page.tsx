"use client";

import { SuperAdminSupportLinkGate } from "@/components/auth/super-admin-support-link-gate";

export default function SuperAdminSupportAccessPage() {
  return (
    <SuperAdminSupportLinkGate
      kind="empresa"
      consumePath="/auth/super-admin/company-access/consume"
      destination="/painel/dashboard"
      returnPath="/super-admin/empresas"
    />
  );
}
