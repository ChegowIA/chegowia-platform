import * as XLSX from "@e965/xlsx";
import { CatalogImportService } from "../src/catalog/catalog-import.service";

function sheetBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Cardápio");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

function build(responseContent: string) {
  const sessionCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "import-1", ...data }));
  const tx = {
    catalogImportSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    category: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "category-1", name: "Lanches", position: 0 }),
    },
    product: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: "product-1" }) },
  };
  const prisma = {
    catalogImportSession: {
      create: sessionCreate,
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const ai = {
    chat: jest.fn().mockResolvedValue({
      content: responseContent,
      requestId: "deepseek-import-1",
      usage: { inputTokens: 430, cachedInputTokens: 30, uncachedInputTokens: 400, outputTokens: 160 },
    }),
  };
  const usage = { recordAiUsage: jest.fn().mockResolvedValue({}) };
  return { service: new CatalogImportService(prisma as never, ai as never, usage as never), prisma, tx, ai, usage, sessionCreate };
}

describe("CatalogImportService", () => {
  const normalizedResponse = JSON.stringify({
    products: [{
      sourceRows: ["Cardápio / linha 2"],
      category: "Lanches",
      name: "X-Burger",
      description: "Pão, carne e queijo",
      price: "24,90",
      costPrice: "10,50",
      isFeatured: "sim",
      variations: [{ name: "Duplo", priceDelta: "8" }],
      addons: [{ name: "Bacon", price: "4" }],
      unit: "un",
    }],
    warnings: ["Confira a foto antes de publicar."],
  });

  it("interpreta a planilha, cobra os tokens reais e mantém opções ligadas ao produto", async () => {
    const { service, ai, usage, sessionCreate } = build(normalizedResponse);

    const preview = await service.preview("empresa-1", "admin-1", {
      originalname: "meu-cardapio.xlsx",
      buffer: sheetBuffer([["Produto", "Valor"], ["X-Burger", "24,90"]]),
    });

    expect(ai.chat).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      expect.objectContaining({ responseFormat: "json_object", thinking: false }),
    );
    expect(usage.recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "empresa-1",
      inputTokens: 430,
      outputTokens: 160,
      requestId: "deepseek-import-1",
    }));
    expect(preview.items[0]).toEqual(expect.objectContaining({
      name: "X-Burger",
      price: 24.9,
      costPrice: 10.5,
      isFeatured: true,
      variations: [{ name: "Duplo", priceDelta: 8 }],
      addons: [{ name: "Bacon", price: 4 }],
      unit: "UN",
    }));
    expect(sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: "empresa-1", createdByUserId: "admin-1" }),
    }));
  });

  it("não inventa preço quando a IA não encontra um valor", async () => {
    const { service } = build(JSON.stringify({
      products: [{ category: "Bebidas", name: "Suco natural", price: null }],
      warnings: [],
    }));

    const preview = await service.preview("empresa-1", "admin-1", {
      originalname: "antiga.xls",
      buffer: sheetBuffer([["Item"], ["Suco natural"]]),
    });

    expect(preview.items[0]).toEqual(expect.objectContaining({ price: null, include: false }));
    expect(preview.items[0].validationErrors).toContain("Preço de venda não foi identificado. Informe-o antes de publicar.");
  });

  it("só publica linhas da própria prévia e cria categoria/produto numa única transação", async () => {
    const { service, prisma, tx } = build(normalizedResponse);
    prisma.catalogImportSession.findFirst.mockResolvedValue({
      id: "import-1",
      companyId: "empresa-1",
      createdByUserId: "admin-1",
      status: "PENDENTE",
      expiresAt: new Date(Date.now() + 10 * 60_000),
      normalizedProducts: [{
        rowKey: "row_1",
        sourceRows: [],
        include: true,
        category: "Lanches",
        name: "X-Burger",
        description: "Pão, carne e queijo",
        price: 24.9,
        costPrice: 10.5,
        imageUrl: null,
        isFeatured: true,
        variations: [{ name: "Duplo", priceDelta: 8 }],
        addons: [{ name: "Bacon", price: 4 }],
        unit: "UN",
        validationErrors: [],
        warnings: [],
        duplicate: false,
      }],
    });

    const result = await service.apply("empresa-1", "admin-1", "import-1", {
      duplicateStrategy: "SKIP" as never,
      items: [{ rowKey: "row_1", include: true, category: "Lanches", name: "X-Burger", price: 24.9, variations: [{ name: "Duplo", priceDelta: 8 }], addons: [{ name: "Bacon", price: 4 }] }],
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.catalogImportSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "APLICADO" }),
    }));
    expect(tx.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId: "empresa-1",
        categoryId: "category-1",
        name: "X-Burger",
        variations: { create: [{ name: "Duplo", priceDelta: 8 }] },
        addons: { create: [{ name: "Bacon", price: 4 }] },
      }),
    }));
    expect(result).toEqual(expect.objectContaining({ createdProducts: 1, createdCategories: 1 }));
  });
});
