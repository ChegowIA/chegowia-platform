"use client";

import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, refreshAccessToken } from "@/lib/api-client";
import { AuthUser, useAuthStore } from "@/lib/auth-store";
import { connectSocket, disconnectSocket } from "@/lib/socket-client";
import { CustomerOrderTracker } from "@/components/orders/customer-order-tracker";
import { PlatformSupportBubble, PlatformSupportFallback } from "@/components/support/platform-support-bubble";
import { NonCriticalBoundary } from "@/components/system/non-critical-boundary";

function sessionExpiresAtMs(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const accessToken = useAuthStore((state) => state.accessToken);
  const sessionExpiresAt = useAuthStore((state) => state.sessionExpiresAt);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const setSessionLoading = useAuthStore((state) => state.setSessionLoading);
  const queryClient = useQueryClient();
  const isAuditedSupportView = Boolean(user?.impersonation?.supportAccess);

  const expireSession = useCallback(() => {
    const deadline = sessionExpiresAtMs(useAuthStore.getState().sessionExpiresAt);
    // Não deixe um timer antigo encerrar uma sessão nova que entrou em outra
    // aba enquanto ele aguardava.
    if (deadline === null || deadline > Date.now()) return;
    useAuthStore.getState().clear();
    queryClient.clear();
    disconnectSocket();
    if (typeof window !== "undefined" && window.location.pathname !== "/acesso") {
      window.location.replace("/acesso?motivo=sessao-expirada");
    }
  }, [queryClient]);

  useEffect(() => {
    if (!hasHydrated) return;

    let cancelled = false;

    async function syncSession() {
      setSessionLoading(true);
      const token = useAuthStore.getState().accessToken;
      const deadline = sessionExpiresAtMs(useAuthStore.getState().sessionExpiresAt);

      try {
        if (deadline !== null && deadline <= Date.now()) {
          expireSession();
          return;
        }
        if (!token) {
          await refreshAccessToken();
          return;
        }

        try {
          const { data } = await api.get<AuthUser>("/auth/me", { notify: false });
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
  }, [expireSession, hasHydrated, setSession, setSessionLoading]);

  /**
   * A sessão não depende de uma próxima requisição para terminar. Assim um
   * painel deixado aberto, inclusive em tablet, sai no momento exato das 24h.
   */
  useEffect(() => {
    if (!hasHydrated || !accessToken) return;
    const deadline = sessionExpiresAtMs(sessionExpiresAt);
    if (deadline === null) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      expireSession();
      return;
    }
    const timer = window.setTimeout(expireSession, remaining);
    return () => window.clearTimeout(timer);
  }, [accessToken, expireSession, hasHydrated, sessionExpiresAt]);

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
      {!isAuditedSupportView && (
        <NonCriticalBoundary name="suporte" fallback={<PlatformSupportFallback />}>
          <PlatformSupportBubble />
        </NonCriticalBoundary>
      )}
    </>
  );
}
