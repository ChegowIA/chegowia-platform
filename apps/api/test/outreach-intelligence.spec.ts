import * as XLSX from "@e965/xlsx";
import {
  mapOutreachRows, outreachPreviewFingerprint, parseOutreachConsentDate, parseOutreachWorkbook,
  suggestOutreachMapping, validateOutreachMapping, validateOutreachVariables,
} from "../src/messaging/outreach-intelligence";
import { OutreachIntelligenceService } from "../src/messaging/outreach-intelligence.service";

function xlsx(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Leads");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

describe("importação XLSX de prospecção", () => {
  it("preserva todas as linhas e células originais, inclusive colunas com cabeçalhos repetidos", () => {
    const workbook = parseOutreachWorkbook(xlsx([
      ["Nome", "Telefone", "Categoria", "Nota", "Nota", "Permissão para WhatsApp"],
      ["Pizzaria Sol", "(62) 99999-8888", "Pizzaria", "A", "B", "Não verificado"],
      ["Pizzaria Lua", "(62) 99999-8888", "Pizzaria", "C", "D", "Sim"],
      ["Loja sem contato", "", "Restaurante", "E", "F", ""],
    ]));
    const sheet = workbook.sheets[0];
    const mapping = suggestOutreachMapping(sheet.headers);
    const rows = mapOutreachRows(sheet, mapping);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
    expect(rows[0].originalData.values.slice(3, 5)).toEqual(["A", "B"]);
    expect(rows[0].phone).toBe("5562999998888");
    expect(rows[0].segment).toBe("Pizzaria");
    expect(rows[2].issue).toMatch(/inválido|ausente/);
    // A coluna de permissão é dado original, não validação automática de opt-in.
    expect(rows[1].consentValue).toBe("Sim");
  });

  it("rejeita telefone incompleto e fixo, sem acrescentar dígitos por adivinhação", () => {
    const sheet = parseOutreachWorkbook(xlsx([
      ["Empresa", "Celular"],
      ["Sem nono dígito", "62 9999-8888"],
      ["Número fixo", "62 3142-5344"],
      ["DDD inválido", "00 99999-8888"],
    ])).sheets[0];
    const rows = mapOutreachRows(sheet, suggestOutreachMapping(sheet.headers));
    expect(rows.map((row) => row.issue)).toEqual([
      "telefone brasileiro inválido ou ausente",
      "telefone fixo: WhatsApp não confirmado",
      "telefone brasileiro inválido ou ausente",
    ]);
  });

  it("fingerprint vincula arquivo, aba e mapeamento à confirmação", () => {
    const workbook = parseOutreachWorkbook(xlsx([["Nome", "Telefone"], ["Loja", "62999998888"]]));
    const headers = workbook.sheets[0].headers;
    const mapping = suggestOutreachMapping(headers);
    expect(validateOutreachMapping(mapping, headers)).toBe(true);
    expect(validateOutreachMapping({ name: 0, phone: 0 }, headers)).toBe(false);
    expect(outreachPreviewFingerprint(workbook.hash, "Leads", mapping))
      .not.toBe(outreachPreviewFingerprint(workbook.hash, "Outra aba", mapping));
  });

  it("não perde uma aba cujos cabeçalhos precisam de mapeamento assistido", () => {
    const sheet = parseOutreachWorkbook(xlsx([
      ["Fantasia comercial", "Canal principal", "Ramo local"],
      ["Açaí Lua", "62 99999-8888", "Açaiteria"],
    ])).sheets[0];
    expect(sheet.rows).toHaveLength(1);
    expect(mapOutreachRows(sheet, { name: 0, phone: 1, segment: 2 })[0].name).toBe("Açaí Lua");
  });

  it("mapeia origem, evidência e data/hora sem tratar uma permissão isolada como opt-in", () => {
    const sheet = parseOutreachWorkbook(xlsx([
      ["Nome", "Telefone", "Categoria", "Permissão para WhatsApp", "Origem da autorização", "Evidência da autorização", "Data da autorização"],
      ["Pizzaria Sol", "62 99999-8888", "Pizzaria", "Sim", "Formulário do site", "protocolo-123456", "01/08/2024 14:30"],
      ["Pizzaria Lua", "62 99999-8887", "Pizzaria", "Sim", "", "", ""],
      ["Pizzaria Mar", "62 99999-8886", "Pizzaria", "Sim", "Formulário do site", "", "01/08/2024 14:30"],
      ["Pizzaria Céu", "62 99999-8885", "Pizzaria", "Sim", "Formulário do site", "protocolo-123456", "31/02/2024 14:30"],
    ])).sheets[0];
    const mapping = suggestOutreachMapping(sheet.headers);
    expect(mapping).toMatchObject({ consent: 3, consentSource: 4, consentEvidence: 5, consentAt: 6 });
    const rows = mapOutreachRows(sheet, mapping);
    expect(rows[0]).toMatchObject({ consentSource: "Formulário do site", consentEvidence: "protocolo-123456", consentIssue: null });
    expect(rows[0].consentAt?.toISOString()).toBe("2024-08-01T17:30:00.000Z");
    expect(rows[1].consentAt).toBeNull();
    expect(rows[2].consentIssue).toMatch(/incompleta/);
    expect(rows[3].consentIssue).toMatch(/data.*inválida/);
    expect(parseOutreachConsentDate("2024-08-01T17:30:00Z")?.toISOString()).toBe("2024-08-01T17:30:00.000Z");
    expect(parseOutreachConsentDate("25/10/2026")?.toISOString()).toBe("2026-10-25T03:00:00.000Z");
    expect(parseOutreachConsentDate("01/01/2999 10:00")).toBeNull();
    expect(suggestOutreachMapping(["Nome", "Telefone", "Categoria", "Origem da autorização", "Evidência", "Data"]).consentAt).toBe(5);
    expect(suggestOutreachMapping(["Nome", "Telefone", "Data de cadastro"]).consentAt).toBeUndefined();
  });

  it("mostra a autorização na prévia e a persiste somente nas linhas completas", async () => {
    const buffer = xlsx([
      ["Nome", "Telefone", "Categoria", "Origem da autorização", "Evidência da autorização", "Data", "Permissão para WhatsApp"],
      ["Pizzaria Sol", "62 99999-8888", "Pizzaria", "Formulário do site", "protocolo-123456", "01/08/2024", "Sim"],
      ["Pizzaria Lua", "62 99999-8887", "Pizzaria", "Formulário do site", "", "01/08/2024", "Sim"],
      ["Pizzaria Mar", "62 99999-8886", "Pizzaria", "", "", "", ""],
      ["Pizzaria Não", "62 99999-8885", "Pizzaria", "Formulário do site", "protocolo-123456", "01/08/2024", "Não"],
    ]);
    const targets: any[] = [];
    const importRows: any[] = [];
    const db: any = {
      platformWhatsAppChannel: { findUnique: jest.fn().mockResolvedValue({ id: "channel-1" }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: "Admin" }) },
      platformOutreachBlock: { findMany: jest.fn().mockResolvedValue([]) },
      platformOutreachTarget: { findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(async ({ data }: any) => { targets.push(...data); }) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      platformOutreachCampaign: { create: jest.fn(async ({ data }: any) => ({ id: "campaign-1", ...data })) },
      platformOutreachImportRow: { createMany: jest.fn(async ({ data }: any) => { importRows.push(...data); }) },
    };
    db.$transaction = jest.fn((callback: any) => callback(db));
    const service = new OutreachIntelligenceService(db, { chat: jest.fn() } as never);
    const preview = await service.preview(buffer);
    expect(preview.verifiedConsent).toBe(1);
    expect(preview.unverifiedConsent).toBe(3);
    expect(preview.samples[1].consentIssue).toMatch(/incompleta/);
    const result = await service.confirmImport(buffer, { hash: preview.hash,
      previewFingerprint: preview.previewFingerprint, sheet: preview.selectedSheet,
      mapping: preview.mapping, name: "Campanha de teste" }, "admin-1");
    expect(result).toMatchObject({ authorizationReady: 1, authorizationPending: 2, excludedRows: 1 });
    expect(targets[0]).toMatchObject({ consentStatus: "CONFIRMADO", consentSource: "Formulário do site", consentEvidence: "protocolo-123456" });
    expect(targets[0].consentAt.toISOString()).toBe("2024-08-01T03:00:00.000Z");
    expect(targets[1].consentStatus).toBe("NAO_VERIFICADO");
    expect(targets[1].consentSource).toBe("Formulário do site");
    expect(targets[1].consentAt).toBeNull();
    expect(targets[3]).toMatchObject({ status: "DESCARTADO", consentStatus: "NEGADO", discardReason: "planilha indica não contatar" });
    expect(importRows[0].originalData.values[4]).toBe("protocolo-123456");
    expect(importRows[1].mappedData.consentIssue).toMatch(/incompleta/);
  });
});

describe("variáveis do modelo preenchidas pela DeepSeek", () => {
  it("encaixa nome e atividade no modelo e completa a cidade pelos dados", () => {
    const { variables } = validateOutreachVariables(
      { nomeCurto: "Schimidt Alimentos", atividade: "Pães para hamburguerias", alertas: [] }, { city: "Goiânia" });
    expect(variables).toEqual(["Schimidt Alimentos", "pães para hamburguerias", "Goiânia"]);
    expect(validateOutreachVariables({ nomeCurto: "Bar do Zé", atividade: "petiscos" }, { city: null }).variables[2])
      .toBe("sua região");
  });
  it("rejeita o que a Meta recusaria ou o que estraga a frase", () => {
    const ok = { nomeCurto: "Pizzaria Sol", atividade: "pizzas", alertas: [] };
    expect(() => validateOutreachVariables({ ...ok, nomeCurto: "Pizzaria\nSol" }, { city: null })).toThrow();
    expect(() => validateOutreachVariables({ ...ok, nomeCurto: "#pizza Goiânia" }, { city: null })).toThrow();
    expect(() => validateOutreachVariables({ ...ok, atividade: "pizzas com 50% de desconto" }, { city: null })).toThrow();
    expect(() => validateOutreachVariables({ ...ok, atividade: "pizzas 🍕" }, { city: null })).toThrow();
    expect(() => validateOutreachVariables({ ...ok, nomeCurto: "A".repeat(41) }, { city: null })).toThrow();
    expect(() => validateOutreachVariables({ ...ok, atividade: undefined }, { city: null })).toThrow();
  });
});

describe("edição versionada do prompt comercial", () => {
  it("salva prompts curtos e maiores que o antigo limite sem truncar", async () => {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data));
    const db: any = { platformOutreachPrompt: {
      findFirst: jest.fn().mockResolvedValue({ version: 3, systemPrompt: "versão anterior" }), create,
    } };
    const service = new OutreachIntelligenceService(db, { chat: jest.fn() } as never);
    const short = await service.updatePrompt("  Nova orientação  ", "admin-1");
    expect(short).toMatchObject({ version: 4, systemPrompt: "Nova orientação" });

    const longText = "Orientação comercial contextualizada. ".repeat(2_200).trim();
    const long = await service.updatePrompt(longText, "admin-1");
    expect(long.systemPrompt).toBe(longText);
    expect(long.systemPrompt.length).toBeGreaterThan(65_535);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejeita somente texto vazio ou valor que não seja string", async () => {
    const service = new OutreachIntelligenceService({} as never, { chat: jest.fn() } as never);
    await expect(service.updatePrompt("   ", "admin-1")).rejects.toThrow("Informe o texto");
    await expect(service.updatePrompt({ texto: "indevido" } as never, "admin-1")).rejects.toThrow("Informe o texto");
  });
});

describe("falha da DeepSeek na fila persistente", () => {
  it("limita regenerações e envia JSON inválido para revisão, sem liberar mensagem", async () => {
    const campaign = { id: "c1", status: "RASCUNHO", preparationRequestedAt: new Date(),
      promptVersion: 1, templateBodySnapshot: "Olá {{1}}. {{2}}", templateParamsSnapshot: ["nome", "proposta"] };
    const target = { id: "t1", campaignId: "c1", status: "PENDENTE", generationStatus: "PENDENTE",
      generationAttempts: 0, name: "Pizzaria Sol", segment: "Pizzaria", city: "Goiânia" };
    const updates: Array<Record<string, unknown>> = [];
    const db: any = {
      platformOutreachCampaign: { findFirst: jest.fn().mockResolvedValue(campaign) },
      platformOutreachTarget: {
        findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(target),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(({ data }: any) => { updates.push(data); return Promise.resolve({ ...target, ...data }); }),
      },
    };
    const ai = { chat: jest.fn().mockResolvedValue({ content: "isso não é JSON" }) };
    const service = new OutreachIntelligenceService(db, ai as never);
    await service.prepareNext();
    expect(updates.at(-1)?.generationStatus).toBe("PENDENTE");
    expect(updates.at(-1)?.messageText).toBeUndefined();
    target.generationAttempts = 1;
    await service.prepareNext();
    expect(updates.at(-1)?.generationStatus).toBe("REVISAO");
    expect(ai.chat).toHaveBeenCalledTimes(2);
  });

  it("usa contrato de saída e instrução corretiva para deixar a segunda tentativa pronta", async () => {
    const campaign = { id: "c1", status: "RASCUNHO", preparationRequestedAt: new Date(), promptVersion: 1 };
    const target = { id: "t1", campaignId: "c1", status: "PENDENTE", generationStatus: "PENDENTE",
      generationAttempts: 0, aiInputTokens: 0, aiOutputTokens: 0,
      name: "Pizzaria Sol", segment: "Pizzaria", city: null };
    const updates: Array<Record<string, unknown>> = [];
    const db: any = {
      platformOutreachCampaign: { findFirst: jest.fn().mockResolvedValue(campaign) },
      platformOutreachTarget: {
        findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(target),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(({ data }: any) => { updates.push(data); return Promise.resolve({ ...target, ...data }); }),
      },
    };
    const ai = { chat: jest.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ nomeCurto: "Pizzaria Sol - a melhor pizza de Goiânia #delivery",
        atividade: "pizzas", alertas: [] }),
        usage: { inputTokens: 80, outputTokens: 35 }, requestId: "request-failed" })
      .mockResolvedValueOnce({ content: JSON.stringify({ nomeCurto: "Pizzaria Sol", atividade: "pizzas e delivery", alertas: [] }),
        usage: { inputTokens: 100, outputTokens: 40 } }) };
    const service = new OutreachIntelligenceService(db, ai as never);

    await service.prepareNext();
    expect(updates.at(-1)?.generationStatus).toBe("PENDENTE");
    expect(updates.at(-1)?.errorMessage).toContain("nomeCurto");
    expect(updates.at(-1)?.aiInputTokens).toBe(80);
    expect(updates.at(-1)?.aiOutputTokens).toBe(35);
    target.generationAttempts = 1;
    target.aiInputTokens = 80;
    target.aiOutputTokens = 35;
    await service.prepareNext();

    expect(updates.at(-1)?.generationStatus).toBe("PRONTO");
    expect(updates.at(-1)?.templateVariables).toEqual(["Pizzaria Sol", "pizzas e delivery", "sua região"]);
    expect(updates.at(-1)?.messageText).toContain("Oi, Pizzaria Sol! Tudo bem?");
    expect(updates.at(-1)?.messageText).toContain("trabalham com pizzas e delivery em sua região");
    expect(updates.at(-1)?.approvalStatus).toBe("PENDENTE");
    expect(updates.at(-1)?.aiInputTokens).toBe(180);
    expect(updates.at(-1)?.aiOutputTokens).toBe(75);
    const [messages, , options] = ai.chat.mock.calls[1];
    expect(messages[0].content).toContain("última tentativa");
    expect(messages[0].content).toContain("2 a 40 caracteres");
    expect(options.temperature).toBe(0.2);
  });
});
