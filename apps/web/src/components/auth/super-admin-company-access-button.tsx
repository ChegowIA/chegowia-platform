"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

interface AccessLinkResponse {
  accessUrl: string;
}

/**
 * O token não é copiado para estado global nem para logs do browser: a API o
 * retorna uma vez e a navegação o leva no fragmento da URL (`#`).
 */
export function SuperAdminCompanyAccessButton({
  companyId,
  label = "Abrir como admin",
  compact = false,
}: {
  companyId: string;
  label?: string;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const createLink = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<AccessLinkResponse>(
        `/auth/super-admin/company-access-links/${companyId}`,
      );
      return data;
    },
    onSuccess: ({ accessUrl }) => {
      // A página de destino remove o fragmento da barra assim que carregar; o
      // segredo, portanto, não persiste no endereço visível do navegador.
      window.location.assign(accessUrl);
    },
    onError: (reason) => setError(apiErrorMessage(reason, "Não foi possível abrir o acesso de suporte.")),
  });

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        title="Abre uma sessão de suporte registrada, válida por até 1 hora."
        isLoading={createLink.isPending}
        onClick={() => {
          setError(null);
          createLink.mutate();
        }}
      >
        {compact ? "Acessar" : label}
      </Button>
      {error && <p role="alert" className="max-w-52 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
