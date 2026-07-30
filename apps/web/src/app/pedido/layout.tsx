"use client";

import { Role } from "@chegowia/shared";
import { RequireRole } from "@/components/auth/require-role";

export default function PedidoLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={[Role.CLIENTE]}>{children}</RequireRole>;
}
