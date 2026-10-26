import { createHash } from "node:crypto";
import * as XLSX from "@e965/xlsx";
import { normalizarTelefoneBrasileiro, pareceTelefoneFixo } from "./outreach-contacts";
import { outreachVariables } from "./outreach-template";

export const OUTREACH_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const OUTREACH_MAX_ROWS = 10_000;
export const OUTREACH_MAX_COLUMNS = 80;
export const OUTREACH_MIN_INTERVAL_MS = 60_000;

export const OUTREACH_FIELDS = [
  "name", "phone", "segment", "city", "state", "address", "website", "consent",
  "consentSource", "consentEvidence", "consentAt",
] as const;
export type OutreachField = typeof OUTREACH_FIELDS[number];
export type OutreachMapping = Partial<Record<OutreachField, number>>;

/**
 * Prompt padrão: preencher as variáveis do modelo aprovado, não escrever a mensagem.
 *
 * A primeira mensagem para quem nunca escreveu só pode ser modelo aprovado pela
 * Meta. O texto fixo já vende; o que a IA faz é o que um vendedor faria ao
 * olhar a lista: chamar o negócio pelo nome que o dono usa e dizer, com as
 * palavras do cliente, o que ele vende.
 */
export const OUTREACH_PROMPT_V1 = `Você é um especialista sênior em prospecção comercial para negócios de alimentação. A mensagem de abertura já está escrita e aprovada pela Meta; sua tarefa é preencher, para um estabelecimento, as duas lacunas que tornam a mensagem pessoal.
Mensagem fixa: "Oi, {{1}}! Tudo bem? Aqui é da ChegowIA. Vi que vocês trabalham com {{2}} em {{3}} e lembrei de vocês: ..."
nomeCurto ({{1}}) é o nome do estabelecimento como o próprio dono falaria. Listas do Google Maps trazem nomes como "Schimidt Alimentos - Fábrica de pães - #pão para hambúrguer, fornecedor de pão Goiânia": nesse caso o nome é "Schimidt Alimentos". Remova slogans, hashtags, palavras de busca, cidade, telefone e descrições. Mantenha a grafia original da marca. Se não houver nome de marca reconhecível, use "pessoal".
atividade ({{2}}) é o que o negócio vende, em linguagem natural e minúscula, para completar "Vi que vocês trabalham com ___": por exemplo "pizzas e delivery", "hambúrgueres artesanais", "pães para hamburguerias", "açaí e sorvetes", "marmitas". Use somente o que o nome e o segmento mostram; na dúvida, prefira algo mais geral e verdadeiro, como "lanches" ou "alimentação".
Não invente produtos, especialidades, prêmios, tempo de mercado ou qualquer fato ausente nos dados. Não use emoji, adjetivos de elogio ("melhor", "incrível"), preço ou promessa.`;

/** Contrato técnico da resposta: protege o modelo aprovado de valores que a Meta recusa. */
export const OUTREACH_OUTPUT_CONTRACT = `Formato obrigatório: responda somente um objeto JSON com as chaves nomeCurto, atividade e alertas.
nomeCurto: 2 a 40 caracteres, sem quebra de linha, hashtag, link, telefone ou emoji.
atividade: 3 a 60 caracteres, começando em minúscula, sem quebra de linha, link, emoji, preço ou promessa.
alertas: array de frases curtas somente quando houver inconsistência concreta nos dados (por exemplo, nome que parece de outra cidade ou de outro ramo); caso contrário [].
Não escreva Markdown nem texto fora do JSON.`;

/** A base do produto é revisada no código; o modelo não pode criar capacidades novas. */
export const OUTREACH_PRODUCT_FACTS = [
  "Gestão de pedidos de delivery e retirada no local",
  "Atendimento pelo WhatsApp com automação e assistente de IA",
  "Cardápio com variações e adicionais",
  "Acompanhamento de entregas e motoboys",
  "QR Code para pedidos na mesa",
  "Painéis de operação e indicadores gerenciais",
  "Gestão de funcionários e permissões",
  "Emissão de NFC-e quando configurada com certificado e regras fiscais aplicáveis",
];

const ALIASES: Record<OutreachField, string[]> = {
  name: ["estabelecimento", "nome do estabelecimento", "nome", "empresa", "nome da empresa", "razao social"],
  phone: ["telefone", "telefone internacional", "telefone formatado", "telefone e164", "celular", "contato", "whatsapp", "telefone so digitos"],
  segment: ["segmento", "segmento principal", "categoria", "categoryname", "ramo", "tipo de negocio"],
  city: ["cidade", "municipio"],
  state: ["uf", "estado"],
  address: ["endereco completo", "endereco", "rua endereco original", "rua", "logradouro", "bairro"],
  website: ["website", "website url cadastrada", "website link cadastrado", "site", "url", "dominio"],
  consent: ["permissao para whatsapp", "permissao whatsapp", "permissao_whatsapp", "autorizacao", "opt in", "consentimento"],
  consentSource: ["origem da autorizacao", "origem do opt in", "origem do consentimento", "canal da autorizacao"],
  consentEvidence: ["evidencia da autorizacao", "evidencia do opt in", "evidencia", "protocolo da autorizacao", "comprovante da autorizacao"],
  consentAt: ["data da autorizacao", "data e hora da autorizacao", "data do opt in", "data do consentimento", "autorizado em", "data"],
};

function cleanHeader(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function suggestOutreachMapping(headers: string[]): OutreachMapping {
  const used = new Set<number>();
  const mapping: OutreachMapping = {};
  for (const field of OUTREACH_FIELDS) {
    let best: { index: number; score: number } | null = null;
    headers.forEach((header, index) => {
      if (used.has(index)) return;
      const cleaned = cleanHeader(header);
      if (!cleaned || /^link whatsapp|^status|^proximo|^ultimo/.test(cleaned)) return;
      const aliases = ALIASES[field];
      const exact = aliases.findIndex((alias) => cleanHeader(alias) === cleaned);
      const partial = aliases.some((alias) => cleanHeader(alias) !== "data" && cleaned.startsWith(`${cleanHeader(alias)} `));
      const score = exact >= 0 ? 100 - exact : partial ? 30 : 0;
      if (score > (best?.score ?? 0)) best = { index, score };
    });
    if (best) {
      const chosen = best as { index: number; score: number };
      mapping[field] = chosen.index;
      used.add(chosen.index);
    }
  }
  return mapping;
}

export function validateOutreachMapping(mapping: OutreachMapping, headers: string[]) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
  const seen = new Set<number>();
  for (const [field, index] of Object.entries(mapping)) {
    if (!OUTREACH_FIELDS.includes(field as OutreachField) || !Number.isInteger(index)
      || index! < 0 || index! >= headers.length || seen.has(index!)) return false;
    seen.add(index!);
  }
  return mapping.name !== undefined && mapping.phone !== undefined;
}

export function outreachPreviewFingerprint(fileHash: string, sheet: string, mapping: OutreachMapping) {
  const ordered = Object.fromEntries(OUTREACH_FIELDS.map((field) => [field, mapping[field] ?? null]));
  return createHash("sha256").update(JSON.stringify({ fileHash, sheet, mapping: ordered })).digest("hex");
}

export type OutreachRawRow = { rowNumber: number; values: string[] };
export type OutreachSheet = { name: string; headers: string[]; rows: OutreachRawRow[]; nonEmptyRows: number };

export function parseOutreachWorkbook(buffer: Buffer): { hash: string; sheets: OutreachSheet[] } {
  if (!buffer?.length || buffer.length > OUTREACH_MAX_FILE_BYTES) throw new Error("A planilha deve ser XLSX de até 5 MB.");
  if (buffer.subarray(0, 2).toString("hex") !== "504b") throw new Error("Arquivo inválido: envie um XLSX.");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellFormula: false });
  if (workbook.SheetNames.length > 20) throw new Error("A planilha tem abas demais (máximo 20).");
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true });
    if (raw.length > OUTREACH_MAX_ROWS + 25) throw new Error(`A aba ${name} excede ${OUTREACH_MAX_ROWS} linhas.`);
    if (raw.some((row) => row.length > OUTREACH_MAX_COLUMNS)) throw new Error(`A aba ${name} excede ${OUTREACH_MAX_COLUMNS} colunas.`);
    let headerIndex = raw.findIndex((row) => {
      const headers = row.map((value) => String(value ?? ""));
      const mapping = suggestOutreachMapping(headers);
      return mapping.name !== undefined && mapping.phone !== undefined;
    });
    // Cabeçalhos inteiramente fora dos aliases ainda podem ser mapeados pela
    // DeepSeek na prévia. Nunca inferimos os valores das linhas com a IA.
    if (headerIndex < 0) headerIndex = raw.findIndex((row, index) => index < 25
      && row.filter((value) => String(value ?? "").trim()).length >= 2
      && raw.slice(index + 1).some((next) => next.some((value) => String(value ?? "").trim())));
    if (headerIndex < 0) return { name, headers: [], rows: [], nonEmptyRows: 0 };
    const headers = raw[headerIndex].map((value) => String(value ?? ""));
    if (headers.some((header) => header.length > 180))
      throw new Error(`A aba ${name} contém um cabeçalho com mais de 180 caracteres.`);
    const rows = raw.slice(headerIndex + 1).map((row, index) => ({
      rowNumber: headerIndex + index + 2,
      values: row.map((value) => String(value ?? "")),
    })).filter((row) => row.values.some((value) => value.trim()));
    if (rows.some((row) => row.values.some((value) => value.length > 2000)))
      throw new Error(`A aba ${name} contém célula com mais de 2.000 caracteres; nenhuma informação foi truncada.`);
    return { name, headers, rows, nonEmptyRows: rows.length };
  });
  return { hash: createHash("sha256").update(buffer).digest("hex"), sheets };
}

export type MappedOutreachRow = {
  rowNumber: number;
  originalData: { headers: string[]; values: string[] };
  name: string | null;
  phone: string | null;
  segment: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  website: string | null;
  consentValue: string | null;
  consentSource: string | null;
  consentEvidence: string | null;
  consentDateValue: string | null;
  consentAt: Date | null;
  consentIssue: string | null;
  consentDenied: boolean;
  issue: string | null;
};

/** Datas sem fuso na planilha são interpretadas no horário de Brasília; sem hora, usa-se 00:00. */
export function parseOutreachConsentDate(raw: string): Date | null {
  const value = raw.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  const localIso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  const zonedIso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!br && !localIso && !zonedIso) return null;
  const parts = br
    ? { year: +br[3], month: +br[2], day: +br[1], hour: +(br[4] ?? 0), minute: +(br[5] ?? 0), second: +(br[6] ?? 0) }
    : { year: +(localIso ?? zonedIso)![1], month: +(localIso ?? zonedIso)![2], day: +(localIso ?? zonedIso)![3],
        hour: +((localIso ?? zonedIso)![4] ?? 0), minute: +((localIso ?? zonedIso)![5] ?? 0), second: +((localIso ?? zonedIso)![6] ?? 0) };
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (calendar.getUTCFullYear() !== parts.year || calendar.getUTCMonth() !== parts.month - 1
    || calendar.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
  const normalized = zonedIso ? value : `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
    + `T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}-03:00`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) && date <= new Date() ? date : null;
}

export function mapOutreachRows(sheet: OutreachSheet, mapping: OutreachMapping): MappedOutreachRow[] {
  if (!validateOutreachMapping(mapping, sheet.headers)) throw new Error("Mapeamento inválido: selecione nome e telefone sem repetir colunas.");
  return sheet.rows.map((row) => {
    const value = (field: OutreachField) => mapping[field] === undefined ? null : (row.values[mapping[field]!] ?? "").trim() || null;
    // Array posicional preserva até cabeçalhos repetidos, sem sobrescrever a
    // coluna anterior com a mesma chave.
    const originalData = { headers: sheet.headers, values: sheet.headers.map((_, index) => row.values[index] ?? "") };
    const phoneRaw = value("phone");
    const phone = phoneRaw ? normalizarTelefoneBrasileiro(phoneRaw) : null;
    const name = value("name")?.slice(0, 120) ?? null;
    const consentSource = value("consentSource");
    const consentEvidence = value("consentEvidence");
    const consentDateValue = value("consentAt");
    const consentDenied = /^(?:n[aã]o|negad[oa]|recusad[oa]|revogad[oa]|n[aã]o contatar|pare|stop|opt[ -]?out)$/i.test(value("consent") ?? "");
    const suppliedConsent = Boolean(consentSource || consentEvidence || consentDateValue);
    const consentAt = consentDateValue ? parseOutreachConsentDate(consentDateValue) : null;
    const consentIssue = consentDenied ? "planilha indica não contatar"
      : !suppliedConsent ? null
      : !consentSource || !consentEvidence || !consentDateValue ? "autorização incompleta: informe origem, evidência e data"
        : consentSource.length < 3 || consentSource.length > 191 ? "origem da autorização deve ter de 3 a 191 caracteres"
          : consentEvidence.length < 12 || consentEvidence.length > 1000 ? "evidência deve ter de 12 a 1.000 caracteres"
            : !consentAt ? "data da autorização inválida ou futura; use dd/mm/aaaa, dd/mm/aaaa HH:mm ou ISO com fuso" : null;
    const issue = !name ? "nome do estabelecimento ausente"
      : !phone ? "telefone brasileiro inválido ou ausente"
        : pareceTelefoneFixo(phone) ? "telefone fixo: WhatsApp não confirmado" : null;
    return {
      rowNumber: row.rowNumber, originalData, name, phone,
      segment: value("segment")?.slice(0, 120) ?? null,
      city: value("city")?.slice(0, 80) ?? null,
      state: value("state")?.slice(0, 2) ?? null,
      address: value("address")?.slice(0, 500) ?? null,
      website: value("website")?.slice(0, 500) ?? null,
      consentValue: value("consent")?.slice(0, 120) ?? null,
      consentSource, consentEvidence, consentDateValue, consentAt: consentIssue ? null : consentAt,
      consentIssue, consentDenied,
      issue,
    };
  });
}

export type GeneratedOutreachVariables = { variables: string[]; alertas: string[] };

export function validateOutreachVariables(raw: unknown, facts: { city: string | null }): GeneratedOutreachVariables {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A IA não retornou um objeto JSON.");
  const obj = raw as Record<string, unknown>;
  const alertas = obj.alertas ?? [];
  if (!Array.isArray(alertas) || !alertas.every((item) => typeof item === "string" && item.length <= 180))
    throw new Error("Alertas inválidos.");
  return {
    variables: outreachVariables({ nomeCurto: obj.nomeCurto, atividade: obj.atividade, cidade: facts.city }),
    alertas: alertas as string[],
  };
}
