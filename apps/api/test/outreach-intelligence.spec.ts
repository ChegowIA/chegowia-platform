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
});
