"use client";

import { useEffect } from "react";
import { api, refreshAccessToken } from "@/lib/api-client";
import { AuthUser, useAuthStore } from "@/lib/auth-store";

export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const setSession = useAuthStore((state) => state.setSession);
  const setSessionLoading = useAuthStore((state) => state.setSessionLoading);

  useEffect(() => {
    if (!hasHydrated) return;

    let cancelled = false;

    async function syncSession() {
      setSessionLoading(true);
      const token = useAuthStore.getState().accessToken;

      try {
        if (!token) {
          await refreshAccessToken();
          return;
        }

        try {
          const { data } = await api.get<AuthUser>("/auth/me");
          if (!cancelled) setSession(token, data);
        } catch {
          if (!cancelled) await refreshAccessToken();
        }
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    }

    syncSession();

    return () => {
      cancelled = true;
    };
  }, [hasHydrated, setSession, setSessionLoading]);

  return <>{children}</>;
}
