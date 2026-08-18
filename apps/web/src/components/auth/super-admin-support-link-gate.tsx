"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type SupportKind = "empresa" | "revendedor";

const copy: Record<SupportKind, { target: string; destination: string; back: string }> = {
  empresa: {
    target: "empresa",
    destination: "a visão administrativa da empresa",
    back: "Voltar às empresas",
  },
  revendedor: {
    target: "revendedor",
    destination: "a visão de suporte do revendedor",
    back: "Voltar aos revendedores",
  },
};

/**
 * Captura o segredo exclusivamente do fragmento da URL e só o envia para a API
 * depois que a sessão do superadmin estiver pronta. Empresa e revendedor usam
 * chaves próprias para que um link nunca seja consumido pelo fluxo errado.
 */
export function SuperAdminSupportLinkGate({
  kind,
  consumePath,
  destination,
  returnPath,
}: {
  kind: SupportKind;
  consumePath: string;
  destination: string;
  returnPath: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isSessionLoading = useAuthStore((state) => state.isSessionLoading);
  const setSession = useAuthStore((state) => state.setSession);
  const [token, setToken] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const storageKey = `chegowia-super-admin-support-link:${kind}`;
  const labels = copy[kind];

  useEffect(() => {
    const fromFragment = window.location.hash.slice(1);
    const candidate = fromFragment || window.sessionStorage.getItem(storageKey) || "";
    if (fromFragment) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    if (TOKEN_PATTERN.test(candidate)) {
      window.sessionStorage.setItem(storageKey, candidate);
      setToken(candidate);
    } else if (candidate) {
      window.sessionStorage.removeItem(storageKey);
      setError("Este atalho de suporte é inválido ou expirou.");
    }
    setCaptured(true);
  }, [storageKey]);

  useEffect(() => {
    if (!captured || !hasHydrated || isSessionLoading || error) return;
    if (!token) {
      setError("Este atalho de suporte é inválido ou expirou.");
      return;
    }
    if (!user) {
      const continuePath = kind === "empresa" ? "/acesso/suporte" : "/acesso/suporte/revendedor";
      router.replace(`/acesso?continuar=${encodeURIComponent(continuePath)}`);
      return;
    }
    if (started.current) return;
    started.current = true;

    api.post(consumePath, { token })
      .then(({ data }) => {
        window.sessionStorage.removeItem(storageKey);
        queryClient.clear();
        setSession(data.accessToken, data.user);
        router.replace(destination);
      })
      .catch((reason) => {
        window.sessionStorage.removeItem(storageKey);
        setError(apiErrorMessage(reason, "Não foi possível abrir este acesso de suporte."));
      });
  }, [captured, consumePath, destination, error, hasHydrated, isSessionLoading, kind, queryClient, router, setSession, storageKey, token, user]);

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.06] p-7 text-center shadow-2xl">
        {error ? (
          <>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Acesso não disponível</p>
            <h1 className="mt-3 text-2xl font-black">Não foi possível abrir o suporte</h1>
            <p role="alert" className="mt-3 text-sm leading-6 text-slate-300">{error}</p>
            <button type="button" onClick={() => router.replace(returnPath)} className="mt-6 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950 dark:bg-white dark:text-slate-950">{labels.back}</button>
          </>
        ) : (
          <>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-300">Acesso seguro de suporte</p>
            <h1 className="mt-3 text-2xl font-black">Validando sua sessão</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">Confirme sua identidade e abriremos {labels.destination}.</p>
            <span className="mx-auto mt-6 block h-7 w-7 animate-spin rounded-full border-2 border-brand-300 border-r-transparent" />
          </>
        )}
      </section>
    </main>
  );
}
