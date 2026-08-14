"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

interface AccessLinkResponse {
  accessUrl: string;
}

/** Abre somente a visão auditada e de leitura da carteira de um parceiro. */
export function SuperAdminResellerAccessButton({
  resellerId,
  compact = false,
}: {
  resellerId: string;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const createLink = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<AccessLinkResponse>(
        `/auth/super-admin/reseller-access-links/${resellerId}`,
      );
      return data;
    },
    onSuccess: ({ accessUrl }) => {
      // O segredo fica no fragmento da URL e a tela de destino o remove antes
      // de renderizar a central do revendedor.
      window.location.assign(accessUrl);
    },
    onError: (reason) => setError(apiErrorMessage(reason, "Não foi possível abrir a visão do revendedor.")),
  });

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        title="Abre uma sessão de suporte registrada e somente leitura, válida por até 1 hora."
        isLoading={createLink.isPending}
        onClick={() => {
          setError(null);
          createLink.mutate();
        }}
      >
        {compact ? "Acessar" : "Abrir visão de suporte"}
      </Button>
      {error && <p role="alert" className="max-w-56 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
