"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Troca de senha para quem já está logado.
 *
 * Não há campo de senha aqui de propósito: quem conclui a troca é quem abre o
 * e-mail da conta. Uma sessão aberta em máquina alheia consegue disparar o
 * envio, mas não consegue trocar nada — e o e-mail denuncia a tentativa.
 */
export function ChangePasswordCard() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: async () =>
      (await api.post<{ emailHint: string; message: string }>("/auth/change-password")).data,
    onSuccess: (result) => {
      setError(null);
      setSentTo(result.emailHint);
    },
    onError: (cause) => {
      setSentTo(null);
      setError(apiErrorMessage(cause));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Senha de acesso</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {sentTo ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
              Link enviado para {sentTo}
            </p>
            <p className="mt-1 text-sm leading-6 text-emerald-800 dark:text-emerald-300">
              Abra o e-mail e defina a nova senha. O link vale por 30 minutos e só pode ser usado uma vez.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            Enviamos um link para o e-mail da sua conta e você define a nova senha por lá. Fazemos assim
            porque só quem tem acesso à sua caixa de entrada consegue concluir a troca.
          </p>
        )}

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Ao trocar a senha, todas as sessões abertas são encerradas — inclusive esta.
        </p>

        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>

      <CardActions description="Não encontrou o e-mail? Confira a caixa de spam antes de pedir de novo.">
        <Button
          variant={sentTo ? "outline" : "primary"}
          onClick={() => request.mutate()}
          isLoading={request.isPending}
          disabled={request.isPending}
        >
          {sentTo ? "Enviar de novo" : "Trocar minha senha"}
        </Button>
      </CardActions>
    </Card>
  );
}
