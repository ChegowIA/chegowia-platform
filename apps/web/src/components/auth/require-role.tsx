"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@chegowia/shared";
import { homePathForRole } from "@/lib/auth-routes";
import { useAuthStore } from "@/lib/auth-store";

export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isSessionLoading = useAuthStore((s) => s.isSessionLoading);
  const router = useRouter();

  useEffect(() => {
    if (!hasHydrated || isSessionLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!roles.includes(user.role)) router.replace(homePathForRole(user.role));
  }, [hasHydrated, isSessionLoading, user, roles, router]);

  if (!hasHydrated || isSessionLoading || !user || !roles.includes(user.role)) return null;
  return <>{children}</>;
}
