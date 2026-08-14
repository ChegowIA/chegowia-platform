"use client";

import { SuperAdminSupportLinkGate } from "@/components/auth/super-admin-support-link-gate";

export default function SuperAdminResellerSupportAccessPage() {
  return (
    <SuperAdminSupportLinkGate
      kind="revendedor"
      consumePath="/auth/super-admin/reseller-access/consume"
      destination="/revendedor/dashboard"
      returnPath="/super-admin/revendedores"
    />
  );
}
