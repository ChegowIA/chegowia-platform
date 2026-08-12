"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LoginContext = {
  kind: "PLATFORM" | "COMPANY" | "STANDALONE";
  role?: string;
  companyId: string | null;
  label: string;
  slug?: string;
  roles?: string[];
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  FUNCIONARIO: "Funcionário",
  COZINHA: "Cozinha",
  MOTOBOY: "Motoboy",
  GARCOM: "Garçom",
  REVENDEDOR: "Revendedor",
  CLIENTE: "Cliente",
};

/**
 * Seletor mostrado logo após o login para a conta multiacesso.
 *
 * O usuário já está autenticado neste ponto — a sessão emitida no login é a de
 * plataforma. Escolher outro contexto troca o token pelo papel selecionado.
 *
 * A empresa é escolhida antes do papel porque a combinação cresce rápido: com
 * dez empresas e cinco papéis, uma lista plana teria cinquenta linhas.
 */
export function ContextPicker({ onDone }: { onDone: () => void }) {
  const setSession = useAuthStore((state) => state.setSession);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openCompanyId, setOpenCompanyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["auth-contexts"],
    queryFn: async () =>
      (await api.get<{ multiContext: boolean; contexts: LoginContext[] }>("/auth/contexts")).data,
  });

  const choose = useMutation({
    mutationFn: async (payload: { companyId: string | null; role?: string }) => {
      return (await api.post("/auth/context", payload)).data;
    },
    onSuccess: (result) => {
      setSession(result.accessToken, result.user);
      onDoneRef.current();
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  });

  const contexts = useMemo(() => data?.contexts ?? [], [data]);
  const companies = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = contexts.filter((context) => context.kind === "COMPANY");
    return term ? all.filter((context) => context.label.toLowerCase().includes(term)) : all;
  }, [contexts, search]);

  const platform = contexts.find((context) => context.kind === "PLATFORM");
  const standalone = contexts.filter((context) => context.kind === "STANDALONE");

  const notMultiContext = Boolean(!isLoading && data && !data.multiContext);
  useEffect(() => {
    if (notMultiContext) onDoneRef.current();
  }, [notMultiContext]);
  if (notMultiContext) return null;

  const pending = choose.isPending;

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50">Como você quer entrar?</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Sua conta enxerga o sistema por qualquer papel. Você pode trocar depois, saindo e entrando de novo.
        </p>
      </div>

      {isLoading ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">Carregando acessos…</p>
      ) : (
        <div className="space-y-4">
          {platform && (
            <button
              type="button"
              onClick={() => choose.mutate({ companyId: null })}
              disabled={pending}
              className="w-full rounded-2xl border-2 border-brand-200 bg-brand-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-400 disabled:opacity-60 dark:border-brand-800 dark:bg-brand-900/30"
            >
              <p className="text-sm font-black text-brand-800 dark:text-brand-200">{platform.label}</p>
              <p className="mt-1 text-xs text-brand-700 dark:text-brand-300">
                Superadministrador: todas as empresas, planos, revendedores e suporte.
              </p>
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
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">Entrar em uma empresa</p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {companies.map((context) => {
                  const open = openCompanyId === context.companyId;
                  return (
                    <div
                      key={context.companyId}
                      className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenCompanyId(open ? null : context.companyId)}
                        className="flex w-full items-center justify-between p-4 text-left"
                      >
                        <span>
                          <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                            {context.label}
                          </span>
                          {context.slug && <span className="block text-xs text-slate-400">/{context.slug}</span>}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">
                          {open ? "Fechar" : "Escolher papel"}
                        </span>
                      </button>

                      {open && (
                        <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
                          {(context.roles ?? []).map((role) => (
                            <Button
                              key={role}
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => choose.mutate({ companyId: context.companyId, role })}
                            >
                              {ROLE_LABEL[role] ?? role}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {companies.length === 0 && search.trim() && (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Nenhuma empresa encontrada para “{search.trim()}”.
            </p>
          )}

          {standalone.length > 0 && (
            <div className="space-y-2">
              {/* Papéis que não pertencem a uma empresa: a visão deles não usa tenant. */}
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">Entrar sem empresa</p>
              <div className="flex flex-wrap gap-2">
                {standalone.map((context) => (
                  <Button
                    key={context.role}
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => choose.mutate({ companyId: null, role: context.role })}
                  >
                    {ROLE_LABEL[context.role ?? ""] ?? context.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {pending && <p className="text-center text-sm text-slate-500 dark:text-slate-400">Entrando…</p>}
      {error && <p className="text-center text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
