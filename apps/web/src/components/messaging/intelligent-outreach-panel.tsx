"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { QRCodeSVG } from "qrcode.react";

type Field = "name" | "phone" | "segment" | "city" | "state" | "address" | "website" | "consent" | "consentSource" | "consentEvidence" | "consentAt";
const FIELDS: Array<{ key: Field; label: string }> = [
  { key: "name", label: "Estabelecimento" }, { key: "phone", label: "Telefone" },
  { key: "segment", label: "Segmento" }, { key: "city", label: "Cidade" },
  { key: "state", label: "UF" }, { key: "address", label: "Endereço" },
  { key: "website", label: "Website" }, { key: "consent", label: "Permissão (informativa)" },
  { key: "consentSource", label: "Origem da autorização" },
  { key: "consentEvidence", label: "Evidência da autorização" },
  { key: "consentAt", label: "Data e hora da autorização" },
];
type Mapping = Partial<Record<Field, number>>;
type Preview = {
  hash: string; previewFingerprint: string; selectedSheet: string; mapping: Mapping;
  sheets: Array<{ name: string; rows: number; headers: string[] }>;
  totalRows: number; validRows: number; invalidRows: number; duplicatePhones: number;
  verifiedConsent: number; unverifiedConsent: number; aiMappingUsed: boolean; mappingWarning: string | null;
  samples: Array<{ rowNumber: number; name: string | null; phone: string | null;
    segment: string | null; city: string | null; consent: string | null;
    consentSource: string | null; consentEvidence: string | null; consentDate: string | null;
    consentReady: boolean; consentIssue: string | null; issue: string | null }>;
};
type Campaign = {
  id: string; name: string; status: string; sourceType: string; totalTargets: number; pendingCount: number;
  sentCount: number; repliedCount: number; failedCount: number; approvedAt: string | null;
  preparationRequestedAt: string | null; pausedReason: string | null; createdAt: string;
};
type Attempt = { id: string; status: string; startedAt: string; finishedAt: string | null;
  errorMessage: string | null; providerMessageId: string | null };
type Target = {
  id: string; sourceRowNumber: number | null; name: string | null; phoneFormatted: string;
  segment: string | null; city: string | null; status: string; consentStatus: string;
  consentSource: string | null; consentEvidence: string | null; consentAt: string | null; generationStatus: string;
  proposal: string | null; messageText: string | null; mainBenefit: string | null;
  approvalStatus: string; responseCategory: string | null; responseSuggestion: string | null;
  responseText: string | null;
  discardReason: string | null; errorMessage: string | null; attempt: Attempt | null;
};
type TargetPage = { total: number; page: number; pageSize: number; targets: Target[] };
type IssuePage = { total: number; page: number; pageSize: number;
  rows: Array<{ id: string; rowNumber: number; status: string; reason: string | null;
    originalData: { headers: string[]; values: string[] } }> };
type Simulation = { ready: number; total: number; pendingConsent: number; pendingCopy: number;
  pendingApproval: number; aiInputTokens: number; aiOutputTokens: number; sent: 0 };
type Sender = { configured: boolean; status: string; phone: string | null; qrCode: string | null;
  workerOnline: boolean; lastHeartbeatAt: string | null; lastError: string | null;
  queued: number; sent: number; failed: number; activeCampaign: { id: string; name: string } | null;
  inFlightTargetId: string | null; nextAllowedAt: string | null };
type Prompt = { version: number; systemPrompt: string };

const API = "/platform/whatsapp/outreach";
function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
}
const statusLabel: Record<string, string> = {
  RASCUNHO: "Rascunho", ENVIANDO: "Enviando", PAUSADA: "Pausada", CONCLUIDA: "Concluída", CANCELADA: "Cancelada",
  PENDENTE: "Pendente", RESERVADO: "Tentativa em andamento", ENVIADO: "Aceito pela API", RESPONDEU: "Respondeu",
  FALHOU: "Falhou", DESCARTADO: "Excluído", NAO_VERIFICADO: "Não verificada", CONFIRMADO: "Confirmada",
  NEGADO: "Negada", NAO_PREPARADO: "Sem mensagem", EM_PREPARO: "Gerando", PRONTO: "Pronta", REVISAO: "Revisão manual",
  APROVADO: "Aprovada", REJEITADO: "Rejeitada",
};

export function IntelligentOutreachPanel() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [mappingDirty, setMappingDirty] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [issuePage, setIssuePage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const [proposalDraft, setProposalDraft] = useState<Record<string, string>>({});
  const [consentDraft, setConsentDraft] = useState<Record<string, { source: string; evidence: string; at: string }>>({});

  function updateConsentDraft(target: Target, field: "source" | "evidence" | "at", value: string) {
    setConsentDraft((current) => ({ ...current, [target.id]: {
      source: current[target.id]?.source ?? target.consentSource ?? "",
      evidence: current[target.id]?.evidence ?? target.consentEvidence ?? "",
      at: current[target.id]?.at ?? localDateTime(target.consentAt), [field]: value,
    } }));
  }

  function consentPayload(target: Target) {
    const current = consentDraft[target.id];
    const at = current?.at ?? localDateTime(target.consentAt);
    return { status: "CONFIRMADO", source: current?.source ?? target.consentSource ?? "",
      evidence: current?.evidence ?? target.consentEvidence ?? "",
      at: at ? new Date(at).toISOString() : "" };
  }

  const campaigns = useQuery({ queryKey: ["intelligent-outreach-campaigns"],
    queryFn: async () => (await api.get<Campaign[]>(`${API}/campaigns`)).data,
    refetchInterval: 15_000 });
  const sender = useQuery({ queryKey: ["intelligent-outreach-sender"],
    queryFn: async () => (await api.get<Sender>(`${API}/sender`)).data, refetchInterval: 3_000 });
  const prompt = useQuery({ queryKey: ["intelligent-outreach-prompt"],
    queryFn: async () => (await api.get<Prompt>(`${API}/prompt`)).data });
  const targets = useQuery({ queryKey: ["intelligent-outreach-targets", selectedCampaign, page],
    queryFn: async () => (await api.get<TargetPage>(`${API}/campaigns/${selectedCampaign}/targets`, { params: { page } })).data,
    enabled: Boolean(selectedCampaign), refetchInterval: 15_000 });
  const issues = useQuery({ queryKey: ["intelligent-outreach-issues", selectedCampaign, issuePage],
    queryFn: async () => (await api.get<IssuePage>(`${API}/campaigns/${selectedCampaign}/import-issues`, { params: { page: issuePage } })).data,
    enabled: Boolean(selectedCampaign) });
  const activeCampaign = campaigns.data?.find((item) => item.id === selectedCampaign);

  async function run(action: () => Promise<unknown>, refresh = true) {
    setBusy(true); setError(null);
    try {
      await action();
      if (refresh) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["intelligent-outreach-campaigns"] }),
          queryClient.invalidateQueries({ queryKey: ["intelligent-outreach-targets"] }),
          queryClient.invalidateQueries({ queryKey: ["intelligent-outreach-issues"] }),
          queryClient.invalidateQueries({ queryKey: ["intelligent-outreach-sender"] }),
        ]);
      }
    } catch (cause) { setError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  }

  function fileData(extra: Record<string, string> = {}) {
    if (!file) throw new Error("Escolha a planilha XLSX.");
    const body = new FormData(); body.append("file", file);
    for (const [key, value] of Object.entries(extra)) body.append(key, value);
    return body;
  }

  async function previewFile(sheet?: string, useMapping = false) {
    await run(async () => {
      const body = fileData({ ...(sheet ? { sheet } : {}), ...(useMapping ? { mapping: JSON.stringify(mapping) } : {}) });
      const result = (await api.post<Preview>(`${API}/import/preview`, body, { notify: false })).data;
      setPreview(result); setMapping(result.mapping); setMappingDirty(false);
    }, false);
  }

  async function performCampaign(action: string) {
    if (!selectedCampaign) return;
    await run(async () => {
      if (action === "cancel") await api.delete(`${API}/campaigns/${selectedCampaign}`);
      else if (action === "simulate") setSimulation((await api.post<Simulation>(`${API}/campaigns/${selectedCampaign}/simulate`)).data);
      else await api.post(`${API}/campaigns/${selectedCampaign}/${action}`);
    });
  }

  async function targetAction(id: string, action: string, body?: unknown) {
    await run(async () => {
      if (action === "exclude") await api.delete(`${API}/targets/${id}`);
      else if (action === "regenerate") await api.post(`${API}/targets/${id}/regenerate`);
      else if (action === "review") await api.post(`${API}/targets/${id}/review`, body);
      else await api.patch(`${API}/targets/${id}/${action}`, body);
    });
  }

  return <section className="space-y-5" aria-label="Central de Prospecção Inteligente">
    <div>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-600 dark:text-orange-300">Acesso exclusivo do superadministrador</p>
      <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">Central de Prospecção Inteligente</h2>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-300">
        Importe, revise e aprove cada abordagem. A DeepSeek prepara uma mensagem individualizada; o número dedicado é conectado por QR Code.
        Sem autorização comprovada, não há envio.
      </p>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}

    <Card><CardContent className="space-y-3 p-5">
      <h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">WhatsApp de Prospecção</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300">Número exclusivo, conectado por QR Code no worker independente. A Gupshup operacional permanece separada.</p>
      <div className="flex flex-wrap gap-3 text-sm text-slate-800 dark:text-slate-200">
        <span>Conexão: <strong>{sender.data?.status ?? "carregando"}</strong></span>
        <span>Número: <strong>{sender.data?.phone || "não conectado"}</strong></span>
        <span>Worker: <strong>{sender.data?.workerOnline ? "online" : "offline"}</strong></span>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
        <span>Na fila: {sender.data?.queued ?? 0}</span><span>Enviadas: {sender.data?.sent ?? 0}</span>
        <span>Falhas: {sender.data?.failed ?? 0}</span><span>Campanha ativa: {sender.data?.activeCampaign?.name ?? "nenhuma"}</span>
      </div>
      {sender.data?.lastError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{sender.data.lastError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !sender.data?.workerOnline || sender.data?.configured} onClick={() => void run(() => api.post(`${API}/sender/connect`))}>Conectar WhatsApp</Button>
        <Button variant="outline" disabled={busy || !sender.data?.workerOnline || sender.data?.status === "DESCONECTADO"} onClick={() => {
          if (window.confirm("Desconectar o número de prospecção? As campanhas em andamento deixarão de enviar.")) void run(() => api.post(`${API}/sender/disconnect`));
        }}>Desconectar</Button>
      </div>
      {sender.data?.qrCode && <div className="inline-flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-700 dark:border-slate-600 dark:bg-white dark:text-slate-700">
        <QRCodeSVG value={sender.data.qrCode} size={220} marginSize={2} />
        <span>Escaneie no WhatsApp do número dedicado. O QR Code expira e é atualizado automaticamente.</span>
      </div>}
      {sender.data?.inFlightTargetId && <div className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Tentativa sem conclusão: {sender.data.inFlightTargetId}. Confira no WhatsApp do número dedicado antes de liberar os próximos leads.
        <Button size="sm" variant="outline" disabled={busy} className="ml-2" onClick={() => {
          if (window.confirm("Você verificou a tentativa no WhatsApp? Este lead nunca será reenviado automaticamente."))
            void run(() => api.post(`${API}/sender/reconcile`, { targetId: sender.data!.inFlightTargetId }));
        }}>Conciliar sem reenviar</Button>
      </div>}
      {sender.data?.nextAllowedAt && <p className="text-xs text-slate-500 dark:text-slate-400">Próxima tentativa a partir de {formatDateTime(sender.data.nextAllowedAt)}. Intervalo global mínimo: 60 segundos.</p>}
    </CardContent></Card>

    <details className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <summary className="cursor-pointer text-base font-bold text-slate-950 dark:text-slate-100">Prompt de copywriting</summary>
      <div className="mt-4 max-w-3xl space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">Prompt interno versionado · versão {prompt.data?.version ?? "…"}. Não há limite fixo de caracteres no editor; alterar cria uma versão nova e campanhas preparadas conservam a anterior. A requisição, o modelo de IA e a mensagem gerada ainda têm limites técnicos próprios.</p>
          <Textarea rows={12} value={promptDraft ?? prompt.data?.systemPrompt ?? ""} onChange={(event) => setPromptDraft(event.target.value)} />
          <Button variant="outline" disabled={busy || !promptDraft?.trim()} onClick={() => void run(async () => {
            await api.put(`${API}/prompt`, { systemPrompt: promptDraft }); setPromptDraft(null);
            await queryClient.invalidateQueries({ queryKey: ["intelligent-outreach-prompt"] });
          })}>Criar nova versão do prompt</Button>
      </div>
    </details>

    <Card><CardContent className="space-y-4 p-5">
      <div><h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">1. Importar planilha</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">O arquivo é lido no servidor. A IA vê apenas cabeçalhos ambíguos. Origem, evidência e data/hora completas e válidas são importadas como autorização; uma coluna isolada de “permissão” não basta.</p></div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField label="Arquivo XLSX"><Input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => {
          setFile(event.target.files?.[0] ?? null); setPreview(null); setMapping({}); setMappingDirty(false);
        }} /></FormField>
        <Button disabled={!file || busy} onClick={() => void previewFile()}>Analisar estrutura</Button>
      </div>
      {preview && <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
          <span>{preview.totalRows} linhas não vazias</span><span>{preview.validRows} válidas</span>
          <span>{preview.invalidRows} inválidas</span><span>{preview.duplicatePhones} repetidas</span>
          <span>{preview.verifiedConsent} com autorização declarada</span>
          <span>{preview.unverifiedConsent} sem autorização completa</span>
        </div>
        <label className="block text-sm text-slate-700 dark:text-slate-200">Aba a importar
          <select className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950" value={preview.selectedSheet} onChange={(event) => void previewFile(event.target.value)}>
            {preview.sheets.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.rows} linhas</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((field) => <label key={field.key} className="text-xs font-semibold text-slate-700 dark:text-slate-200">{field.label}
            <select className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950" value={mapping[field.key] ?? ""} onChange={(event) => {
              setMapping((current) => ({ ...current, [field.key]: event.target.value === "" ? undefined : Number(event.target.value) }));
              setMappingDirty(true);
            }}>
              <option value="">Não mapear</option>
              {preview.sheets.find((item) => item.name === preview.selectedSheet)?.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{index + 1}. {header || "Sem cabeçalho"}</option>)}
            </select>
          </label>)}
        </div>
        {preview.mappingWarning && <p className="text-sm text-amber-700 dark:text-amber-300">{preview.mappingWarning}</p>}
        {mappingDirty && <Button variant="outline" disabled={busy} onClick={() => void previewFile(preview.selectedSheet, true)}>Recalcular prévia com este mapeamento</Button>}
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[1100px] text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><tr>
            <th className="p-2">Linha</th><th className="p-2">Estabelecimento</th><th className="p-2">Telefone</th><th className="p-2">Segmento</th>
            <th className="p-2">Origem</th><th className="p-2">Evidência</th><th className="p-2">Data/hora</th><th className="p-2">Validação</th>
          </tr></thead><tbody>{preview.samples.map((row) => <tr key={row.rowNumber} className="border-t border-slate-100 dark:border-slate-800">
            <td className="p-2">{row.rowNumber}</td><td className="p-2">{row.name || "—"}</td><td className="p-2">{row.phone || "—"}</td>
            <td className="p-2">{row.segment || "—"}</td><td className="p-2">{row.consentSource || "—"}</td>
            <td className="max-w-52 break-all p-2">{row.consentEvidence || "—"}</td><td className="p-2">{row.consentDate || "—"}</td>
            <td className="p-2">{row.issue || row.consentIssue || (row.consentReady ? "Autorização pronta para importação" : "Autorização pendente")}</td>
          </tr>)}</tbody></table>
        </div>
        <FormField label="Nome da campanha"><Input value={campaignName} maxLength={120} onChange={(event) => setCampaignName(event.target.value)} placeholder="Ex.: pizzarias de Goiânia · outubro" /></FormField>
        <Button disabled={busy || mappingDirty || !campaignName.trim() || !preview.validRows} onClick={() => void run(async () => {
          const body = fileData({ hash: preview.hash, previewFingerprint: preview.previewFingerprint,
            sheet: preview.selectedSheet, mapping: JSON.stringify(mapping), name: campaignName });
          const result = (await api.post<{ campaignId: string }>(`${API}/import/confirm`, body)).data;
          setSelectedCampaign(result.campaignId); setPage(1); setFile(null); setPreview(null); setCampaignName("");
        })}>Confirmar importação sem enviar</Button>
      </div>}
    </CardContent></Card>

    <Card><CardContent className="space-y-4 p-5">
      <h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">2. Campanhas e aprovação</h3>
      {!campaigns.data?.length && <p className="text-sm text-slate-500">Nenhuma campanha importada.</p>}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{campaigns.data?.map((campaign) => <button key={campaign.id} type="button"
        onClick={() => { setSelectedCampaign(campaign.id); setPage(1); setIssuePage(1); setSimulation(null); setSelectedIds([]); }}
        className={`rounded-xl border p-3 text-left text-sm transition ${selectedCampaign === campaign.id ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : "border-slate-200 dark:border-slate-700"}`}>
        <span className="font-bold text-slate-900 dark:text-slate-100">{campaign.name}</span><span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{statusLabel[campaign.status] || campaign.status}</span>
        <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">{campaign.totalTargets} leads · {campaign.sentCount} tentativas confirmadas · {campaign.repliedCount} respostas · {formatDateTime(campaign.createdAt)}</span>
      </button>)}</div>
      {activeCampaign && <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy || activeCampaign.status !== "RASCUNHO"} onClick={() => void performCampaign("prepare")}>Gerar mensagens com IA</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void performCampaign("simulate")}>Simular sem enviar</Button>
          <Button size="sm" variant="outline" disabled={busy || activeCampaign.status !== "RASCUNHO"} onClick={() => void performCampaign("approve")}>Aprovar campanha</Button>
          {activeCampaign.status === "ENVIANDO"
            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void performCampaign("pause")}>Pausar</Button>
            : <Button size="sm" disabled={busy || !activeCampaign.approvedAt || !sender.data?.configured} onClick={() => void performCampaign("start")}>Iniciar / retomar envios</Button>}
          <Button size="sm" variant="outline" disabled={busy || activeCampaign.status === "CANCELADA"} onClick={() => {
            if (window.confirm("Cancelar a campanha? Os leads não enviados serão descartados.")) void performCampaign("cancel");
          }}>Cancelar</Button>
        </div>
        {activeCampaign.preparationRequestedAt && <p className="text-sm text-sky-700 dark:text-sky-300">A IA está preparando mensagens no servidor. Pode fechar esta página; a fila continua.</p>}
        {activeCampaign.pausedReason && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{activeCampaign.pausedReason}</p>}
        {simulation && <p className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          Simulação: {simulation.ready} de {simulation.total} aptos; {simulation.pendingConsent} sem opt-in comprovado,
          {" "}{simulation.pendingCopy} sem copy validada, {simulation.pendingApproval} sem aprovação.
          Nenhuma mensagem enviada. Tokens IA: {simulation.aiInputTokens} entrada / {simulation.aiOutputTokens} saída.
        </p>}
        {targets.data && <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700 dark:text-slate-300">
            <p>{targets.data.total} leads · página {page} de {Math.max(1, Math.ceil(targets.data.total / targets.data.pageSize))}</p>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => { setPage(page - 1); setSelectedIds([]); }}>Anterior</Button>
              <Button size="sm" variant="outline" disabled={page * targets.data.pageSize >= targets.data.total} onClick={() => { setPage(page + 1); setSelectedIds([]); }}>Próxima</Button></div>
          </div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !selectedIds.length || activeCampaign.status !== "RASCUNHO"} onClick={() => void run(async () => {
            await api.post(`${API}/campaigns/${selectedCampaign}/approve-messages`, { ids: selectedIds }); setSelectedIds([]);
          })}>Aprovar {selectedIds.length} mensagem(ns) selecionada(s)</Button>
            <Button size="sm" variant="outline" disabled={busy || activeCampaign.status !== "RASCUNHO"} onClick={() => setSelectedIds(targets.data!.targets.filter((item) => item.status === "PENDENTE" && item.generationStatus === "PRONTO").map((item) => item.id))}>Selecionar prontas desta página</Button>
          </div>
          <div className="space-y-2">{targets.data.targets.map((target) => <div key={target.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-start gap-3">
              <input type="checkbox" aria-label={`Selecionar ${target.name || target.phoneFormatted}`} checked={selectedIds.includes(target.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, target.id] : current.filter((id) => id !== target.id))} />
              <div className="min-w-[180px] flex-1"><p className="font-bold text-slate-950 dark:text-slate-100">{target.name || "Sem nome"}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300">{target.phoneFormatted} · {target.segment || "Segmento não informado"} · {target.city || "Cidade não informada"}</p></div>
              <div className="text-xs text-slate-600 dark:text-slate-300">{statusLabel[target.consentStatus]} · {statusLabel[target.generationStatus]} · {statusLabel[target.approvalStatus]} · {statusLabel[target.status]}</div>
              <Button size="sm" variant="outline" onClick={() => setExpanded(expanded === target.id ? null : target.id)}>{expanded === target.id ? "Fechar" : "Ver mensagem e dados"}</Button>
            </div>
            {expanded === target.id && <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100">{target.messageText || "Mensagem ainda não preparada."}</p>
              <p className="text-xs text-slate-600 dark:text-slate-300">Benefício: {target.mainBenefit || "—"}. Origem: linha {target.sourceRowNumber ?? "—"}. {target.errorMessage || target.discardReason || ""}</p>
              {target.responseText && <p className="whitespace-pre-wrap rounded-lg bg-sky-50 p-3 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">Resposta recebida: {target.responseText}<br />Classificação: {target.responseCategory || "pendente"}. Sugestão para revisão humana: {target.responseSuggestion || "—"}</p>}
              {target.attempt && <p className="text-xs text-slate-600 dark:text-slate-300">Tentativa {target.attempt.status} em {formatDateTime(target.attempt.startedAt)} · {target.attempt.errorMessage || "sem erro"}</p>}
              {target.status === "PENDENTE" && activeCampaign.status === "RASCUNHO" && <div className="space-y-3">
                <FormField label="Editar mensagem completa"><Textarea rows={5} value={proposalDraft[target.id] ?? target.messageText ?? ""} onChange={(event) => setProposalDraft((current) => ({ ...current, [target.id]: event.target.value }))} /></FormField>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void targetAction(target.id, "proposal", { proposal: proposalDraft[target.id] ?? target.proposal })}>Salvar edição</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void targetAction(target.id, "regenerate")}>Regenerar pela IA</Button>
                  <Button size="sm" disabled={busy || target.generationStatus !== "PRONTO"} onClick={() => void targetAction(target.id, "review", { approved: true })}>Aprovar mensagem</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void targetAction(target.id, "review", { approved: false })}>Rejeitar</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void targetAction(target.id, "exclude")}>Excluir lead</Button>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">Autorização para contato</p>
                  <p className="mb-2 text-xs text-amber-800 dark:text-amber-300">As três colunas completas da planilha são preenchidas automaticamente. Confira se a origem e a evidência correspondem a uma autorização real; não registre por suposição.</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input aria-label="Origem da autorização" placeholder="Origem da autorização" value={consentDraft[target.id]?.source ?? target.consentSource ?? ""} onChange={(event) => updateConsentDraft(target, "source", event.target.value)} />
                    <Input aria-label="Evidência da autorização" placeholder="Evidência (protocolo/link/registro)" value={consentDraft[target.id]?.evidence ?? target.consentEvidence ?? ""} onChange={(event) => updateConsentDraft(target, "evidence", event.target.value)} />
                    <Input aria-label="Data e hora da autorização" type="datetime-local" value={consentDraft[target.id]?.at ?? localDateTime(target.consentAt)} onChange={(event) => updateConsentDraft(target, "at", event.target.value)} />
                  </div>
                  <div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={() => void targetAction(target.id, "consent", consentPayload(target))}>{target.consentStatus === "CONFIRMADO" ? "Atualizar autorização" : "Registrar opt-in"}</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void targetAction(target.id, "consent", { status: "NEGADO" })}>Não contatar</Button></div>
                </div>
              </div>}
            </div>}
          </div>)}</div>
        </div>}
        {issues.data && issues.data.total > 0 && <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-slate-100">Linhas inválidas, duplicadas ou excluídas ({issues.data.total})</summary>
          <div className="mt-3 space-y-2 text-xs text-slate-700 dark:text-slate-300">{issues.data.rows.map((row) => <div key={row.id} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950">
            Linha {row.rowNumber} · {row.status} · {row.reason || "—"}. Origem preservada: {row.originalData.values.join(" | ").slice(0, 300)}
          </div>)}</div>
          <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={issuePage <= 1} onClick={() => setIssuePage(issuePage - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={issuePage * issues.data.pageSize >= issues.data.total} onClick={() => setIssuePage(issuePage + 1)}>Próxima</Button></div>
        </details>}
      </div>}
    </CardContent></Card>
  </section>;
}
