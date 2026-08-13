"use client";

import { useEffect } from "react";
import { api, refreshAccessToken } from "@/lib/api-client";
import { AuthUser, useAuthStore } from "@/lib/auth-store";
import { connectSocket, disconnectSocket } from "@/lib/socket-client";
import { CustomerOrderTracker } from "@/components/orders/customer-order-tracker";
import { PlatformSupportBubble, PlatformSupportFallback } from "@/components/support/platform-support-bubble";
import { NonCriticalBoundary } from "@/components/system/non-critical-boundary";

export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const accessToken = useAuthStore((state) => state.accessToken);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
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

  /**
   * O servidor derruba os sockets quando o vínculo muda (conta desativada,
   * senha alterada ou redefinida). Sem tratar o evento, a pessoa ficaria com a
   * tela viva e sem atualizações, sem entender o que houve.
   */
  useEffect(() => {
    if (!hasHydrated || isSessionLoading || !accessToken) {
      if (hasHydrated && !isSessionLoading && !accessToken) disconnectSocket();
      return;
    }
    const socket = connectSocket();
    // Um socket criado antes da renovação carregaria o JWT antigo (ou vazio).
    // O handshake lê o token atual, então reconectamos só depois de a sessão
    // estar pronta.
    if (socket.connected) socket.disconnect();
    socket.connect();
    const onRevoked = (payload?: { reason?: string }) => {
      useAuthStore.getState().clear();
      disconnectSocket();
      const motivo = payload?.reason ? `?motivo=${encodeURIComponent(payload.reason)}` : "";
      window.location.href = `/acesso${motivo}`;
    };
    socket.on("session.revoked", onRevoked);
    return () => {
      socket.off("session.revoked", onRevoked);
    };
  }, [accessToken, hasHydrated, isSessionLoading]);

  return (
    <>
      {children}
      <NonCriticalBoundary name="acompanhamento de pedido">
        <CustomerOrderTracker />
      </NonCriticalBoundary>
      <NonCriticalBoundary name="suporte" fallback={<PlatformSupportFallback />}>
        <PlatformSupportBubble />
      </NonCriticalBoundary>
    </>
  );
}
