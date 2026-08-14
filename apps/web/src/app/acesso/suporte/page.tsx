"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

const SUPPORT_LINK_STORAGE_KEY = "chegowia-super-admin-support-link";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * O segredo chega depois do `#`, que navegadores não mandam ao servidor nem em
 * Referer. Assim que a página abre, ele sai da barra de endereço e fica apenas
 * em sessionStorage até a autenticação/MFA terminar.
 */
export default function SuperAdminSupportAccessPage() {
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

  useEffect(() => {
    const fromFragment = window.location.hash.slice(1);
    const candidate = fromFragment || window.sessionStorage.getItem(SUPPORT_LINK_STORAGE_KEY) || "";
    if (fromFragment) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    if (TOKEN_PATTERN.test(candidate)) {
      window.sessionStorage.setItem(SUPPORT_LINK_STORAGE_KEY, candidate);
      setToken(candidate);
    } else if (candidate) {
      window.sessionStorage.removeItem(SUPPORT_LINK_STORAGE_KEY);
      setError("Este atalho de suporte é inválido ou expirou.");
    }
    setCaptured(true);
  }, []);

  useEffect(() => {
    if (!captured || !hasHydrated || isSessionLoading || error) return;
    if (!token) {
      setError("Este atalho de suporte é inválido ou expirou.");
      return;
    }
    if (!user) {
      router.replace("/acesso?continuar=%2Facesso%2Fsuporte");
      return;
    }
    if (started.current) return;
    started.current = true;

    api.post("/auth/super-admin/company-access/consume", { token })
      .then(({ data }) => {
        window.sessionStorage.removeItem(SUPPORT_LINK_STORAGE_KEY);
        queryClient.clear();
        setSession(data.accessToken, data.user);
        router.replace("/painel/dashboard");
      })
      .catch((reason) => {
        window.sessionStorage.removeItem(SUPPORT_LINK_STORAGE_KEY);
        setError(apiErrorMessage(reason, "Não foi possível abrir este acesso de suporte."));
      });
  }, [captured, error, hasHydrated, isSessionLoading, queryClient, router, setSession, token, user]);

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.06] p-7 text-center shadow-2xl">
        {error ? (
          <>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Acesso não disponível</p>
            <h1 className="mt-3 text-2xl font-black">Não foi possível abrir o suporte</h1>
            <p role="alert" className="mt-3 text-sm leading-6 text-slate-300">{error}</p>
            <button type="button" onClick={() => router.replace("/super-admin/empresas")} className="mt-6 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950">Voltar às empresas</button>
          </>
        ) : (
          <>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-300">Acesso seguro de suporte</p>
            <h1 className="mt-3 text-2xl font-black">Validando sua sessão</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">Confirme sua identidade e abriremos a visão administrativa da empresa.</p>
            <span className="mx-auto mt-6 block h-7 w-7 animate-spin rounded-full border-2 border-brand-300 border-r-transparent" />
          </>
        )}
      </section>
    </main>
  );
}
