"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LoginContext = {
  kind: "PLATFORM" | "COMPANY";
  role: string;
  companyId: string | null;
  label: string;
  slug?: string;
};

/**
 * Seletor mostrado logo após o login para a conta multiacesso.
 *
 * O usuário já está autenticado neste ponto — a sessão emitida no login é a de
 * plataforma. Escolher uma empresa troca o token por um de ADMIN daquela
 * empresa; escolher a plataforma apenas segue com o que já existe.
 */
export function ContextPicker({ onDone }: { onDone: () => void }) {
  const setSession = useAuthStore((state) => state.setSession);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["auth-contexts"],
    queryFn: async () =>
      (await api.get<{ multiContext: boolean; contexts: LoginContext[] }>("/auth/contexts")).data,
  });

  const choose = useMutation({
    mutationFn: async (companyId: string | null) => {
      return (await api.post("/auth/context", { companyId })).data;
    },
    onSuccess: (result) => {
      setSession(result.accessToken, result.user);
      onDone();
    },
    onError: (cause) => {
      setPendingId(null);
      setError(apiErrorMessage(cause));
    },
  });

  const contexts = useMemo(() => data?.contexts ?? [], [data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contexts;
    return contexts.filter((context) => context.label.toLowerCase().includes(term));
  }, [contexts, search]);

  /**
   * Conta comum nunca vê o seletor: o backend devolve a lista vazia. A saída vai
   * em efeito, e não no corpo do render, porque `onDone` muda estado do pai.
   */
  const notMultiContext = Boolean(!isLoading && data && !data.multiContext);
  useEffect(() => {
    // `onDone` costuma vir como arrow inline e mudaria de identidade a cada
    // render; a ref mantém o efeito preso apenas à condição de saída.
    if (notMultiContext) onDoneRef.current();
  }, [notMultiContext]);
  if (notMultiContext) return null;

  const companies = filtered.filter((context) => context.kind === "COMPANY");
  const platform = contexts.find((context) => context.kind === "PLATFORM");

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50">Como você quer entrar?</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Sua conta tem acesso à plataforma e às empresas. Você pode trocar depois, sem sair.
        </p>
      </div>

      {isLoading ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">Carregando acessos…</p>
      ) : (
        <div className="space-y-4">
          {platform && (
            <button
              type="button"
              onClick={() => {
                setPendingId("platform");
                choose.mutate(null);
              }}
              disabled={choose.isPending}
              className="w-full rounded-2xl border-2 border-brand-200 bg-brand-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-400 disabled:opacity-60 dark:border-brand-800 dark:bg-brand-900/30"
            >
              <p className="text-sm font-black text-brand-800 dark:text-brand-200">{platform.label}</p>
              <p className="mt-1 text-xs text-brand-700 dark:text-brand-300">
                Visão de superadministrador: todas as empresas, planos e suporte.
              </p>
              {pendingId === "platform" && choose.isPending && (
                <p className="mt-2 text-xs font-semibold text-brand-700 dark:text-brand-300">Entrando…</p>
              )}
            </button>
          )}

          {contexts.length > 6 && (
            <Input
              placeholder="Buscar empresa…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}

          {companies.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">
                Entrar como administrador de
              </p>
              {/* A lista pode crescer com a base de clientes; rolagem própria
                  evita que a tela de login vire uma página infinita. */}
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {companies.map((context) => (
                  <button
                    key={context.companyId}
                    type="button"
                    onClick={() => {
                      setPendingId(context.companyId);
                      choose.mutate(context.companyId);
                    }}
                    disabled={choose.isPending}
                    className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <span>
                      <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                        {context.label}
                      </span>
                      {context.slug && (
                        <span className="block text-xs text-slate-400">/{context.slug}</span>
                      )}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">
                      {pendingId === context.companyId && choose.isPending ? "Entrando…" : "Entrar"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {companies.length === 0 && search.trim() && (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Nenhuma empresa encontrada para “{search.trim()}”.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-center text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}

      <div className="text-center">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={choose.isPending}>
          Continuar como plataforma
        </Button>
      </div>
    </div>
  );
}
