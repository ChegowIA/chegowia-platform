import * as XLSX from "@e965/xlsx";
import {
  mapOutreachRows, outreachPreviewFingerprint, parseOutreachWorkbook,
  suggestOutreachMapping, validateOutreachCopy, validateOutreachMapping,
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
});

describe("validação de copy da DeepSeek", () => {
  const facts = { name: "Pizzaria Sol", segment: "Pizzaria", city: "Goiânia" };
  const valid = {
    beneficioPrincipal: "Organização de pedidos",
    proposta: "organizar pedidos e acompanhar entregas de pizzas",
    dadosUtilizados: ["segmento"], alertas: [],
  };
  it("aceita proposta curta contextualizada e estruturada", () => {
    expect(validateOutreachCopy(valid, facts).proposta).toBe(valid.proposta);
  });
  it("rejeita JSON incompleto, placeholders e promessas garantidas", () => {
    expect(() => validateOutreachCopy({ ...valid, dadosUtilizados: undefined }, facts)).toThrow();
    expect(() => validateOutreachCopy({ ...valid, proposta: "organizar {{cliente}} e pedidos" }, facts)).toThrow();
    expect(() => validateOutreachCopy({ ...valid, proposta: "dobrar suas vendas em 30 dias" }, facts)).toThrow();
  });
  it("não admite personalização por campo ausente", () => {
    expect(() => validateOutreachCopy(valid, { ...facts, segment: null })).toThrow();
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
      .mockResolvedValueOnce({ content: JSON.stringify({ beneficioPrincipal: "A".repeat(138),
        proposta: "Olá, podemos conversar sobre pedidos pelo WhatsApp e delivery?", dadosUtilizados: ["segmento"], alertas: [] }),
        usage: { inputTokens: 80, outputTokens: 35 }, requestId: "request-failed" })
      .mockResolvedValueOnce({ content: JSON.stringify({ beneficioPrincipal: "Organização de pedidos",
        proposta: "Olá, equipe da Pizzaria Sol! O ChegowIA ajuda a organizar pedidos e entregas. Faz sentido conversar sobre isso?",
        dadosUtilizados: ["nome", "segmento"], alertas: [] }), usage: { inputTokens: 100, outputTokens: 40 } }) };
    const service = new OutreachIntelligenceService(db, ai as never);

    await service.prepareNext();
    expect(updates.at(-1)?.generationStatus).toBe("PENDENTE");
    expect(updates.at(-1)?.errorMessage).toContain("Benefício principal inválido");
    expect(updates.at(-1)?.aiInputTokens).toBe(80);
    expect(updates.at(-1)?.aiOutputTokens).toBe(35);
    target.generationAttempts = 1;
    target.aiInputTokens = 80;
    target.aiOutputTokens = 35;
    await service.prepareNext();

    expect(updates.at(-1)?.generationStatus).toBe("PRONTO");
    expect(updates.at(-1)?.messageText).toContain("Pizzaria Sol");
    expect(updates.at(-1)?.approvalStatus).toBe("PENDENTE");
    expect(updates.at(-1)?.aiInputTokens).toBe(180);
    expect(updates.at(-1)?.aiOutputTokens).toBe(75);
    const [messages, , options] = ai.chat.mock.calls[1];
    expect(messages[0].content).toContain("última tentativa");
    expect(messages[0].content).toContain("4 a 80 caracteres");
    expect(JSON.parse(messages[1].content).camposDisponiveis).toEqual(["nome", "segmento"]);
    expect(options.temperature).toBe(0.35);
  });
});
