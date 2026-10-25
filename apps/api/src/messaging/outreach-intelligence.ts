import { createHash } from "node:crypto";
import * as XLSX from "@e965/xlsx";
import { normalizarTelefoneBrasileiro, pareceTelefoneFixo } from "./outreach-contacts";

export const OUTREACH_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const OUTREACH_CHANNEL_KEY = "chegowia-prospeccao-qr";
export const OUTREACH_MAX_ROWS = 10_000;
export const OUTREACH_MAX_COLUMNS = 80;
export const OUTREACH_MAX_MESSAGE_CHARS = 500;
export const OUTREACH_MIN_INTERVAL_MS = 60_000;

export const OUTREACH_FIELDS = ["name", "phone", "segment", "city", "state", "address", "website", "consent"] as const;
export type OutreachField = typeof OUTREACH_FIELDS[number];
export type OutreachMapping = Partial<Record<OutreachField, number>>;

export const OUTREACH_PROMPT_V1 = `Você é um especialista sênior em prospecção comercial B2B, marketing digital, copywriting e vendas de softwares SaaS para estabelecimentos alimentícios.
Sua missão é criar uma primeira mensagem de apresentação do ChegowIA para um estabelecimento comercial que autorizou esse tipo de contato.
Analise cuidadosamente os dados fornecidos, especialmente nome e segmento.
Utilize somente fatos comprovados sobre o estabelecimento e funcionalidades reais do ChegowIA.
Crie uma mensagem natural, profissional, objetiva e contextualizada, demonstrando de forma breve como a plataforma pode ser relevante para aquele tipo de negócio.
Não invente problemas enfrentados pelo estabelecimento, nomes de proprietários, faturamento, quantidade de pedidos ou informações ausentes.
Não utilize clichês comerciais exagerados, falsa intimidade, pressão psicológica ou promessas garantidas.
Priorize uma única proposta de valor relevante, uma apresentação breve e uma pergunta final simples que facilite o início de uma conversa comercial.
Evite mensagens longas. A linguagem deve parecer escrita por um consultor comercial experiente, e não por um robô.
Escreva a mensagem completa para revisão humana, com saudação breve, uma proposta de valor e uma pergunta final simples. Responda JSON rigoroso com beneficioPrincipal, proposta (mensagem completa), dadosUtilizados e alertas.`;

/** Contrato técnico da resposta: protege a revisão sem modificar a copy gerada. */
export const OUTREACH_OUTPUT_CONTRACT = `Formato obrigatório: responda somente um objeto JSON com as chaves beneficioPrincipal, proposta, dadosUtilizados e alertas.
beneficioPrincipal deve ser um rótulo curto de 4 a 80 caracteres, como "Organização de pedidos"; nunca um parágrafo.
proposta deve conter a mensagem COMPLETA entre 50 e 450 caracteres, com saudação breve, uma única proposta de valor real e uma pergunta final simples.
Não inclua assinatura, nome fictício do consultor, colchetes, chaves, variáveis, placeholders ou qualquer trecho para preencher depois.
Se o nome do estabelecimento for longo ou parecer texto de busca, não o repita na mensagem; use apenas o segmento disponível sem inventar um nome curto.
Não diga que visitou, pesquisou ou conhece o negócio. Não atribua problemas, volume de pedidos ou resultados ao estabelecimento.
Apresente-se como ChegowIA, sem fingir ser uma pessoa específica ou um consultor humano.
dadosUtilizados deve ser um array somente com campos realmente usados na mensagem, dentre nome, segmento e cidade, e nunca incluir um campo ausente.
alertas deve ser [] quando não houver inconsistência concreta nos dados; não inclua autoavaliação da mensagem.
Antes de responder, revise o JSON, os limites de tamanho e a ausência de placeholders. Não escreva Markdown nem texto fora do JSON.`;

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
      const partial = aliases.some((alias) => cleaned.startsWith(`${cleanHeader(alias)} `));
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
  issue: string | null;
};

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
      issue,
    };
  });
}

export type GeneratedOutreachCopy = { beneficioPrincipal: string; proposta: string; dadosUtilizados: string[]; alertas: string[] };
const BAD_CLAIMS = /\b(garantid[oa]|dobr(ar|e)|triplic(ar|e)|seu (neg[oó]cio|estabelecimento) (perde|sofre|tem problema)|faturamento|vendas em \d+|\d+%|R\$)\b/i;

export function validateOutreachCopy(raw: unknown, facts: { name: string; segment: string | null; city: string | null }): GeneratedOutreachCopy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A IA não retornou um objeto JSON.");
  const obj = raw as Record<string, unknown>;
  if (typeof obj.beneficioPrincipal !== "string" || obj.beneficioPrincipal.trim().length < 4 || obj.beneficioPrincipal.length > 100)
    throw new Error("Benefício principal inválido.");
  if (typeof obj.proposta !== "string" || obj.proposta.trim().length < 30 || obj.proposta.length > OUTREACH_MAX_MESSAGE_CHARS)
    throw new Error("Mensagem comercial inválida.");
  const proposal = obj.proposta.trim();
  if (/[{}<>]/.test(proposal) || /\{\{|\}\}|\[[^\]]+\]/.test(proposal) || BAD_CLAIMS.test(proposal))
    throw new Error("A proposta contém variável não resolvida ou promessa não permitida.");
  if (!Array.isArray(obj.dadosUtilizados) || !obj.dadosUtilizados.every((item) => ["nome", "segmento", "cidade"].includes(item)))
    throw new Error("Fontes da personalização inválidas.");
  if (obj.dadosUtilizados.includes("segmento") && !facts.segment) throw new Error("Segmento não disponível na origem.");
  if (obj.dadosUtilizados.includes("cidade") && !facts.city) throw new Error("Cidade não disponível na origem.");
  if (!Array.isArray(obj.alertas) || !obj.alertas.every((item) => typeof item === "string" && item.length <= 180))
    throw new Error("Alertas inválidos.");
  return {
    beneficioPrincipal: obj.beneficioPrincipal.trim(), proposta: proposal,
    dadosUtilizados: [...new Set(obj.dadosUtilizados as string[])], alertas: obj.alertas as string[],
  };
}
