"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiscalDocumentStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { FiscalDocument, Paginated } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";

/**
 * Baixa um arquivo da API autenticado.
 *
 * `<a href="/api/...">` não serve aqui por dois motivos: a navegação não leva o
 * cabeçalho `Authorization` — e as rotas exigem permissão fiscal, então
 * voltariam 401 —, e em desenvolvimento a API vive em outra origem, onde o
 * caminho relativo nem chega. O mesmo padrão já é usado no download de
 * currículo em super-admin/aprovacoes.
 */
async function baixarArquivo(caminho: string, nomeArquivo: string) {
  const resposta = await api.get(caminho, { responseType: "blob" });
  const url = URL.createObjectURL(resposta.data as Blob);
  const ancora = document.createElement("a");
  ancora.href = url;
  ancora.download = nomeArquivo;
  ancora.click();
  URL.revokeObjectURL(url);
}

/** O cupom abre em aba nova para o lojista mandar direto à impressora. */
async function abrirCupom(caminho: string) {
  const resposta = await api.get(caminho, { responseType: "blob" });
  const url = URL.createObjectURL(resposta.data as Blob);
  window.open(url, "_blank", "noopener");
  // Só revoga depois que a aba teve tempo de carregar o conteúdo.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const STATUS_LABELS: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ASSINADA: "Assinada",
  ENVIANDO: "Enviando",
  AUTORIZADA: "Autorizada",
  REJEITADA: "Rejeitada",
  DENEGADA: "Denegada",
  CANCELADA: "Cancelada",
  CONTINGENCIA: "Em contingência",
  INUTILIZADA: "Inutilizada",
};

const STATUS_CLASSES: Record<string, string> = {
  AUTORIZADA: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  CONTINGENCIA: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  REJEITADA: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  DENEGADA: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  CANCELADA: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function NotasFiscais() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
  const [inutilizar, setInutilizar] = useState({ start: "", end: "", reason: "" });

  const { data } = useQuery({
    queryKey: ["fiscal-documents", status],
    queryFn: async () => (await api.get<Paginated<FiscalDocument>>("/fiscal/nfce", {
      params: status ? { status } : undefined,
    })).data,
    refetchInterval: 60_000,
  });

  const feedback = (mensagem: string) => {
    setError(null);
    setSuccess(mensagem);
    queryClient.invalidateQueries({ queryKey: ["fiscal-documents"] });
  };
  const falhou = (err: unknown) => { setSuccess(null); setError(apiErrorMessage(err)); };

  const transmitir = useMutation({
    mutationFn: async (id: string) => (await api.post(`/fiscal/nfce/${id}/transmitir`)).data,
    onSuccess: () => feedback("Transmissão concluída."),
    onError: falhou,
  });

  const cancelar = useMutation({
    mutationFn: async () => (await api.post(`/fiscal/nfce/${cancelling!.id}/cancelar`, { reason: cancelling!.reason })).data,
    onSuccess: () => { setCancelling(null); feedback("Cancelamento registrado na SEFAZ."); },
    onError: falhou,
  });

  const inutilizarFaixa = useMutation({
    mutationFn: async () => (await api.post("/fiscal/nfce/inutilizar", {
      start: Number(inutilizar.start),
      end: Number(inutilizar.end),
      reason: inutilizar.reason,
    })).data,
    onSuccess: () => { setInutilizar({ start: "", end: "", reason: "" }); feedback("Numeração inutilizada."); },
    onError: falhou,
  });

  const pendentes = data?.items.filter((nota) => nota.status === FiscalDocumentStatus.CONTINGENCIA).length ?? 0;

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
      {success && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{success}</p>}

      {pendentes > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          {pendentes} nota(s) em contingência. Elas são transmitidas automaticamente quando a SEFAZ
          voltar; o botão &quot;Transmitir&quot; força a tentativa agora.
        </p>
      )}

      <Card>
        <CardHeader><CardTitle>Emitidas</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Filtrar por situação">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(STATUS_LABELS).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>{rotulo}</option>
              ))}
            </Select>
          </FormField>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  <th className="py-2">Número</th>
                  <th>Situação</th>
                  <th>Emissão</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((nota) => (
                  <tr key={nota.id} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-2">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{nota.number}/{nota.series}</p>
                      {nota.accessKey && (
                        <p className="text-xs text-slate-400 break-all">{nota.accessKey}</p>
                      )}
                    </td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLASSES[nota.status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                        {STATUS_LABELS[nota.status] ?? nota.status}
                      </span>
                      {nota.actionHint && (
                        <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">{nota.actionHint}</p>
                      )}
                    </td>
                    <td className="text-slate-600 dark:text-slate-300">
                      {new Date(nota.issuedAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="text-right font-semibold">{formatCurrency(nota.totalAmount)}</td>
                    <td className="space-x-2 text-right whitespace-nowrap">
                      {nota.status === FiscalDocumentStatus.CONTINGENCIA && (
                        <Button variant="outline" onClick={() => transmitir.mutate(nota.id)}>Transmitir</Button>
                      )}
                      {nota.status === FiscalDocumentStatus.AUTORIZADA && (
                        <>
                          <button
                            className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-400"
                            onClick={() => abrirCupom(`/fiscal/nfce/${nota.id}/danfe`).catch(falhou)}
                          >
                            Cupom
                          </button>
                          <button
                            className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-400"
                            onClick={() => baixarArquivo(
                              `/fiscal/nfce/${nota.id}/xml`,
                              `NFe${nota.accessKey ?? nota.id}.xml`,
                            ).catch(falhou)}
                          >
                            XML
                          </button>
                          <button
                            className="text-xs font-bold text-rose-600 hover:underline dark:text-rose-400"
                            onClick={() => setCancelling({ id: nota.id, reason: "" })}
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {data?.items.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma nota emitida ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {cancelling && (
        <Card>
          <CardHeader><CardTitle>Cancelar nota</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              A NFC-e só pode ser cancelada em até 30 minutos da autorização, e a SEFAZ exige uma
              justificativa de pelo menos 15 caracteres.
            </p>
            <FormField label="Justificativa">
              <Textarea
                value={cancelling.reason}
                onChange={(e) => setCancelling({ ...cancelling, reason: e.target.value })}
              />
            </FormField>
            <div className="flex gap-2">
              <Button onClick={() => cancelar.mutate()} disabled={cancelling.reason.trim().length < 15 || cancelar.isPending}>
                {cancelar.isPending ? "Cancelando..." : "Confirmar cancelamento"}
              </Button>
              <Button variant="outline" onClick={() => setCancelling(null)}>Voltar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Inutilizar numeração</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Toda nota rejeitada queima um número. A fiscalização cobra a justificativa de cada buraco
            na sequência — inutilizar é como se registra que aquele número não virou documento.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Número inicial">
              <Input type="number" min="1" value={inutilizar.start} onChange={(e) => setInutilizar((f) => ({ ...f, start: e.target.value }))} />
            </FormField>
            <FormField label="Número final">
              <Input type="number" min="1" value={inutilizar.end} onChange={(e) => setInutilizar((f) => ({ ...f, end: e.target.value }))} />
            </FormField>
            <FormField label="Justificativa">
              <Input value={inutilizar.reason} onChange={(e) => setInutilizar((f) => ({ ...f, reason: e.target.value }))} />
            </FormField>
          </div>
          <Button
            variant="outline"
            onClick={() => inutilizarFaixa.mutate()}
            disabled={!inutilizar.start || !inutilizar.end || inutilizar.reason.trim().length < 15}
          >
            Inutilizar faixa
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
