"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/brazil-fields";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";

type ImportOption = { name: string; price?: number; priceDelta?: number };

type ImportItem = {
  rowKey: string;
  sourceRows: string[];
  include: boolean;
  category: string;
  name: string;
  description: string | null;
  price: number | null;
  costPrice: number | null;
  imageUrl: string | null;
  isFeatured: boolean;
  variations: ImportOption[];
  addons: ImportOption[];
  unit?: string | null;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  taxOrigin?: string | null;
  icmsCode?: string | null;
  icmsRate?: number | null;
  pisCode?: string | null;
  pisRate?: number | null;
  cofinsCode?: string | null;
  cofinsRate?: number | null;
  validationErrors: string[];
  warnings: string[];
  duplicate: boolean;
};

type ImportPreview = {
  sessionId: string;
  expiresAt: string;
  sourceSummary: { sheets: Array<{ name: string; rows: number; columns: number; headers: string[] }>; nonEmptyRows: number };
  items: ImportItem[];
  warnings: string[];
  totals: { identified: number; ready: number; needsReview: number; duplicates: number };
};

type ImportResult = {
  createdProducts: number;
  createdCategories: number;
  skippedDuplicates: number;
  requestedProducts: number;
};

export function CatalogImportPanel({ onComplete }: { onComplete: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadTemplate = useMutation({
    mutationFn: async () => {
      const response = await api.get("/catalog/products/import/template", { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "modelo-cardapio-chegowia.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    onError: (requestError) => setError(apiErrorMessage(requestError)),
  });

  const createPreview = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Escolha uma planilha antes de interpretar.");
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post<ImportPreview>("/catalog/products/import/preview", formData);
      return data;
    },
    onSuccess: (data) => {
      setError(null);
      setFeedback(null);
      setPreview(data);
    },
    onError: (requestError) => setError(apiErrorMessage(requestError, requestError instanceof Error ? requestError.message : undefined)),
  });

  const selectedItems = useMemo(
    () => (preview?.items ?? []).filter((item) => item.include && canPublishItem(item)),
    [preview],
  );

  const applyPreview = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Gere uma prévia antes de publicar.");
      if (!selectedItems.length) throw new Error("Selecione ao menos um produto com nome, categoria e preço válidos.");
      const { data } = await api.post<ImportResult>(`/catalog/products/import/${preview.sessionId}/apply`, {
        // A prévia também traz avisos e referências de origem, mas eles são
        // somente leitura. Enviamos ao backend apenas os campos que podem ser
        // revisados/publicados — a API usa whitelist rígida por segurança.
        items: selectedItems.map(({
          sourceRows: _sourceRows,
          validationErrors: _validationErrors,
          warnings: _warnings,
          duplicate: _duplicate,
          ...item
        }) => ({ ...item, include: true })),
        duplicateStrategy: "SKIP",
      });
      return data;
    },
    onSuccess: (data) => {
      setPreview(null);
      setFile(null);
      setError(null);
      setFeedback(
        `${data.createdProducts} produto(s) publicado(s)${data.createdCategories ? ` e ${data.createdCategories} categoria(s) criada(s)` : ""}${data.skippedDuplicates ? `. ${data.skippedDuplicates} duplicado(s) foram preservados` : ""}.`,
      );
      onComplete();
    },
    onError: (requestError) => setError(apiErrorMessage(requestError, requestError instanceof Error ? requestError.message : undefined)),
  });

  function updateItem(rowKey: string, patch: Partial<ImportItem>) {
    setPreview((current) => current
      ? { ...current, items: current.items.map((item) => item.rowKey === rowKey ? { ...item, ...patch } : item) }
      : current,
    );
  }

  return (
    <>
      <Card className="overflow-hidden border-brand-200 bg-gradient-to-br from-brand-50 via-white to-accent-50/40 dark:border-brand-900/60 dark:from-brand-950/25 dark:via-slate-900 dark:to-slate-900">
        <CardHeader className="gap-4 border-b border-brand-100/80 dark:border-brand-900/40">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="max-w-2xl">
              <p className="text-[11px] font-black uppercase tracking-[.16em] text-brand-700 dark:text-brand-300">Importação inteligente</p>
              <CardTitle className="mt-1">Crie seu cardápio a partir de uma planilha</CardTitle>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Envie um arquivo <strong>.xlsx</strong> ou <strong>.xls</strong>. Mesmo que sua planilha tenha colunas diferentes,
                a IA organiza os produtos, preços, categorias, variações e adicionais para você revisar antes de publicar.
              </p>
            </div>
            <Button variant="outline" isLoading={downloadTemplate.isPending} onClick={() => downloadTemplate.mutate()}>
              Baixar modelo padrão
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Step number="1" title="Modelo opcional" text="Baixe o exemplo para começar do zero." />
            <Step number="2" title="IA organiza" text="Ela identifica campos mesmo fora do modelo." />
            <Step number="3" title="Você confirma" text="Nada entra no cardápio sem a sua revisão." />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/25">
            <FileUpload
              key={file ? `${file.name}-${file.lastModified}` : "empty-import-file"}
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              file={file}
              onFile={(nextFile) => {
                setFile(nextFile);
                setError(null);
              }}
              hint="Planilhas XLSX ou XLS · até 5 MB · até 250 produtos por importação"
            />
            <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/80 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                Com o arquivo selecionado, gere a prévia para conferir cada produto antes de publicar.
              </p>
              <Button className="w-full shrink-0 sm:w-auto" disabled={!file} isLoading={createPreview.isPending} onClick={() => createPreview.mutate()}>
                Interpretar e revisar
              </Button>
            </div>
          </div>

          <div className="grid gap-3 text-xs leading-5 text-slate-500 dark:text-slate-400 md:grid-cols-2">
            <p className="rounded-xl bg-slate-100/80 px-3 py-2.5 dark:bg-slate-800/70">
              A IA é usada somente para interpretar a planilha. O consumo real de tokens entra automaticamente na composição da sua conta.
            </p>
            <p className="rounded-xl bg-slate-100/80 px-3 py-2.5 dark:bg-slate-800/70">
              Precisa de ajuda? Abra o Assistente ChegowIA no canto da tela e diga que quer organizar uma planilha de cardápio.
            </p>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          {feedback && <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{feedback}</p>}
        </CardContent>
      </Card>

      <Modal open={Boolean(preview)} onClose={() => !applyPreview.isPending && setPreview(null)} title="Revise antes de publicar">
        {preview && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-slate-950 px-4 py-4 text-slate-100 dark:bg-black/35">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="success">{preview.totals.ready} pronto(s)</Badge>
                {preview.totals.needsReview > 0 && <Badge tone="warning">{preview.totals.needsReview} precisam de revisão</Badge>}
                {preview.totals.duplicates > 0 && <Badge tone="info">{preview.totals.duplicates} possível(is) duplicado(s)</Badge>}
              </div>
              <p className="mt-3 text-sm leading-5 text-slate-300">
                A prévia expira em {formatPreviewExpiry(preview.expiresAt)}. Produtos já existentes com o mesmo nome e categoria serão preservados por padrão.
              </p>
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-bold">Pontos para conferir</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {preview.warnings.slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}

            <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
              {preview.items.map((item) => {
                const ready = canPublishItem(item);
                return (
                  <article key={item.rowKey} className={`rounded-2xl border p-3 ${item.include ? "border-brand-200 bg-white dark:border-brand-900/60 dark:bg-slate-900" : "border-slate-200 bg-slate-50 opacity-75 dark:border-slate-800 dark:bg-slate-900/50"}`}>
                    <div className="mb-3 flex gap-3">
                      <input
                        aria-label={`Publicar ${item.name || "produto sem nome"}`}
                        className="mt-1 h-4 w-4 accent-orange-600"
                        type="checkbox"
                        checked={item.include}
                        onChange={(event) => updateItem(item.rowKey, { include: event.target.checked })}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={ready ? "success" : "warning"}>{ready ? "Pronto" : "Revisar"}</Badge>
                          {item.duplicate && <Badge tone="info">Possível duplicado</Badge>}
                          {item.isFeatured && <Badge tone="brand">Destaque</Badge>}
                          {item.sourceRows[0] && <span className="text-[11px] text-slate-400">{item.sourceRows[0]}</span>}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                          <Input value={item.name} placeholder="Nome do produto" onChange={(event) => updateItem(item.rowKey, { name: event.target.value })} />
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.price ?? ""}
                            placeholder="Preço"
                            onChange={(event) => updateItem(item.rowKey, { price: event.target.value === "" ? null : Number(event.target.value) })}
                          />
                        </div>
                        <Input className="mt-2" value={item.category} placeholder="Categoria" onChange={(event) => updateItem(item.rowKey, { category: event.target.value })} />
                        {item.description && <Textarea className="mt-2 min-h-16" value={item.description} onChange={(event) => updateItem(item.rowKey, { description: event.target.value })} />}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {item.variations.map((variation) => <Badge key={`v-${variation.name}`} tone="neutral">Variação: {variation.name} ({formatCurrency(Number(variation.priceDelta ?? 0))})</Badge>)}
                          {item.addons.map((addon) => <Badge key={`a-${addon.name}`} tone="neutral">Adicional: {addon.name} ({formatCurrency(Number(addon.price ?? 0))})</Badge>)}
                          {item.unit && <Badge tone="neutral">{item.unit}</Badge>}
                        </div>
                        {(item.validationErrors.length > 0 || item.warnings.length > 0) && (
                          <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300">
                            {[...item.validationErrors, ...item.warnings].map((warning, index) => <li key={`${warning}-${index}`}>• {warning}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              Ao publicar, somente os {selectedItems.length} item(ns) selecionado(s) e válidos serão criados. A planilha original não é armazenada pela plataforma.
            </p>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" disabled={applyPreview.isPending} onClick={() => setPreview(null)}>Continuar revisando depois</Button>
              <Button disabled={!selectedItems.length} isLoading={applyPreview.isPending} onClick={() => applyPreview.mutate()}>
                Publicar {selectedItems.length} produto(s)
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl bg-white/75 p-3 dark:bg-slate-950/30">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-black text-white">{number}</span>
      <div><p className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</p><p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{text}</p></div>
    </div>
  );
}

function canPublishItem(item: ImportItem) {
  return item.name.trim().length >= 2
    && item.category.trim().length >= 2
    && typeof item.price === "number"
    && Number.isFinite(item.price)
    && item.price >= 0;
}

function formatPreviewExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "cerca de 30 minutos";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
