import { UsageMetric, UsageSource } from "@prisma/client";
import { UsageService } from "../src/usage/usage.service";

describe("razão de consumo variável", () => {
  it("marca o uso do teste como coberto sem apagar a tarifa registrada", async () => {
    const occurredAt = new Date("2026-08-06T12:00:00.000Z");
    const prisma = {
      clientSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          status: "EM_TESTE",
          trialStartedAt: new Date("2026-08-01T12:00:00.000Z"),
          trialEndsAt: new Date("2026-08-08T12:00:00.000Z"),
        }),
      },
      usageRate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "rate-ai-output",
          unitSize: 1_000,
          providerUnitCost: 0.5,
          markupPercent: 20,
          isActive: true,
        }),
      },
      usageLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    const service = new UsageService(prisma as never);

    await service.record({
      companyId: "empresa-teste",
      source: UsageSource.IA,
      metric: UsageMetric.IA_TOKENS_SAIDA,
      quantity: 1_000,
      createdAt: occurredAt,
    });

    expect(prisma.usageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerAmount: 0.5,
        billableAmount: 0.6,
        trialCoveredAt: occurredAt,
      }),
    }));
  });

  it("fotografa custo do provedor e margem no momento do evento", async () => {
    const prisma = {
      usageRate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "rate-ai-input",
          unitSize: 1000,
          providerUnitCost: 0.5,
          markupPercent: 20,
          isActive: true,
        }),
      },
      usageLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    const service = new UsageService(prisma as never);

    await service.record({
      companyId: "empresa-1",
      source: UsageSource.IA,
      metric: UsageMetric.IA_TOKENS_ENTRADA,
      quantity: 1200,
      externalReference: "ai:req-1:input",
    });

    expect(prisma.usageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        usageRateId: "rate-ai-input",
        providerAmount: 0.6,
        billableAmount: 0.72,
      }),
    }));
  });

  it("separa tokens DeepSeek com cache dos tokens sem cache", async () => {
    const prisma = {
      usageRate: {
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve({
          id: `rate-${where.metric}`,
          unitSize: 1_000_000,
          providerUnitCost: 1,
          markupPercent: 0,
          isActive: true,
        })),
      },
      usageLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    const service = new UsageService(prisma as never);

    await service.recordAiUsage({
      companyId: "empresa-1",
      inputTokens: 1_000_000,
      cachedInputTokens: 250_000,
      uncachedInputTokens: 750_000,
      outputTokens: 100_000,
      requestId: "deepseek-1",
    });

    expect(prisma.usageLedger.create).toHaveBeenCalledTimes(3);
    expect(prisma.usageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metric: UsageMetric.IA_TOKENS_ENTRADA,
        quantity: 750_000,
        externalReference: "ai:deepseek-1:input",
      }),
    }));
    expect(prisma.usageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metric: UsageMetric.IA_TOKENS_ENTRADA_CACHE,
        quantity: 250_000,
        externalReference: "ai:deepseek-1:cache-hit",
      }),
    }));
  });

  it("soma plano base e consumo sem alterar os eventos já registrados", async () => {
    const prisma = {
      usageLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            metric: UsageMetric.IA_TOKENS_SAIDA,
            quantity: 3500,
            providerAmount: 1.75,
            billableAmount: 2.1,
            usageRateId: "rate-output",
            usageRate: { isActive: true },
          },
          {
            metric: UsageMetric.WHATSAPP_TEMPLATE_MARKETING,
            quantity: 3,
            providerAmount: 1.2,
            billableAmount: 1.5,
            usageRateId: "rate-marketing",
            usageRate: { isActive: true },
          },
        ]),
      },
    };
    const service = new UsageService(prisma as never);

    const summary = await service.getMonthlySummary("empresa-1", {
      reference: new Date(2026, 6, 15),
      baseMonthlyPrice: 159.9,
    });

    expect(summary.baseMonthlyPrice).toBe(159.9);
    expect(summary.providerTotal).toBe(2.95);
    expect(summary.variableTotal).toBe(3.6);
    expect(summary.estimatedTotal).toBe(163.5);
    expect(summary.unpricedEvents).toBe(0);
  });
});

describe("resumo mensal para a tela de assinatura", () => {
  function serviceWithEntries(entries: any[]) {
    // O status vem do banco em toda linha real; sem ele nos fixtures o resumo
    // não exercitaria a separação entre consumo já cobrado e a cobrar.
    const comStatus = entries.map((item) => ({ status: "PENDENTE", ...item }));
    const prisma = { usageLedger: { findMany: jest.fn().mockResolvedValue(comStatus) } };
    return new UsageService(prisma as never);
  }

  it("informa quanto do consumo já está em fatura, sem tirar do total", async () => {
    const service = serviceWithEntries([
      { source: UsageSource.IA, metric: UsageMetric.IA_TOKENS_SAIDA, quantity: 1000, providerAmount: 2.1, billableAmount: 6, usageRateId: "r1", usageRate: rate, status: "SINCRONIZADO" },
      { source: UsageSource.IA, metric: UsageMetric.IA_TOKENS_SAIDA, quantity: 200, providerAmount: 0.42, billableAmount: 1.2, usageRateId: "r1", usageRate: rate, status: "PENDENTE" },
    ]);

    const summary = await service.getMonthlySummary("empresa-1", { baseMonthlyPrice: 5 });

    expect(summary.variableTotal).toBeCloseTo(7.2, 2);
    expect(summary.variableInvoiced).toBeCloseTo(6, 2);
    expect(summary.variablePending).toBeCloseTo(1.2, 2);
    /**
     * O total soma tudo, sem descontar o que já entrou em fatura: o consumo
     * sempre vai para a cobrança da mensalidade, então descontar mostraria um
     * total abaixo do valor que a pessoa vai pagar. A separação existe para a
     * tela dizer quanto já está emitido, não para subtrair.
     */
    expect(summary.estimatedTotal).toBeCloseTo(12.2, 2);
  });

  const rate = { isActive: true };

  it("separa os subtotais de IA e WhatsApp em vez de somar tudo", async () => {
    const service = serviceWithEntries([
      { source: UsageSource.IA, metric: UsageMetric.IA_TOKENS_ENTRADA, quantity: 1_000_000, providerAmount: 0.7, billableAmount: 0.84, usageRateId: "r1", usageRate: rate },
      { source: UsageSource.IA, metric: UsageMetric.IA_TOKENS_SAIDA, quantity: 200_000, providerAmount: 0.28, billableAmount: 0.34, usageRateId: "r2", usageRate: rate },
      { source: UsageSource.WHATSAPP, metric: UsageMetric.WHATSAPP_TEMPLATE_MARKETING, quantity: 10, providerAmount: 3.22, billableAmount: 3.86, usageRateId: "r3", usageRate: rate },
    ]);

    const summary = await service.getMonthlySummary("empresa-1", { baseMonthlyPrice: 159.9 });

    const ia = summary.sources.find((item) => item.source === UsageSource.IA);
    const whatsapp = summary.sources.find((item) => item.source === UsageSource.WHATSAPP);
    expect(ia?.billableAmount).toBeCloseTo(1.18, 2);
    expect(ia?.quantity).toBe(1_200_000);
    expect(whatsapp?.billableAmount).toBeCloseTo(3.86, 2);
    expect(whatsapp?.quantity).toBe(10);
  });

  it("informa as duas origens mesmo sem consumo, para a tela não quebrar", async () => {
    const summary = await serviceWithEntries([]).getMonthlySummary("empresa-1", { baseMonthlyPrice: 159.9 });

    expect(summary.sources.map((item) => item.source).sort()).toEqual([UsageSource.IA, UsageSource.WHATSAPP].sort());
    expect(summary.sources.every((item) => item.billableAmount === 0)).toBe(true);
  });

  it("total devido soma a mensalidade ao consumo variável", async () => {
    const service = serviceWithEntries([
      { source: UsageSource.WHATSAPP, metric: UsageMetric.WHATSAPP_TEMPLATE_UTILIDADE, quantity: 4, providerAmount: 0.14, billableAmount: 0.2, usageRateId: "r1", usageRate: rate },
    ]);

    const summary = await service.getMonthlySummary("empresa-1", { baseMonthlyPrice: 159.9 });

    expect(summary.variableTotal).toBeCloseTo(0.2, 2);
    expect(summary.estimatedTotal).toBeCloseTo(160.1, 2);
  });

  it("mostra o consumo do teste, mas o exclui do total que será faturado", async () => {
    const service = serviceWithEntries([
      {
        source: UsageSource.WHATSAPP,
        metric: UsageMetric.WHATSAPP_TEMPLATE_MARKETING,
        quantity: 4,
        providerAmount: 1.2,
        billableAmount: 1.56,
        trialCoveredAt: new Date("2026-08-04T10:00:00.000Z"),
        usageRateId: "r-teste",
        usageRate: rate,
      },
    ]);

    const summary = await service.getMonthlySummary("empresa-teste", { baseMonthlyPrice: 0 });

    expect(summary.providerTotal).toBe(1.2);
    expect(summary.variableTotal).toBe(0);
    expect(summary.estimatedTotal).toBe(0);
    expect(summary.trialCovered).toEqual({ entries: 1, providerTotal: 1.2, nominalAmount: 1.56 });
    expect(summary.items[0]).toMatchObject({ billableAmount: 0, trialQuantity: 4, trialCoveredAmount: 1.56 });
  });

  describe("consumo abaixo de um centavo", () => {
    /**
     * O caso real que expôs o problema: 3.000 tokens de entrada e 226 de saída
     * custam R$ 0,0025 no total. Arredondado a centavo vira zero, e a tela
     * mostrava "R$ 0,00" ao lado de "3,3 mil tokens" — parecia que a
     * contabilização não tinha funcionado.
     */
    const conversaReal = [
      {
        source: UsageSource.IA,
        metric: UsageMetric.IA_TOKENS_ENTRADA,
        quantity: 3_000,
        providerAmount: 0.002132,
        billableAmount: 0.002132,
        usageRateId: "r1",
        usageRate: rate,
      },
      {
        source: UsageSource.IA,
        metric: UsageMetric.IA_TOKENS_SAIDA,
        quantity: 226,
        providerAmount: 0.000321,
        billableAmount: 0.000321,
        usageRateId: "r2",
        usageRate: rate,
      },
    ];

    it("preserva o valor em vez de zerar no arredondamento", async () => {
      const summary = await serviceWithEntries(conversaReal)
        .getMonthlySummary("empresa-1", { baseMonthlyPrice: 159.9 });

      expect(summary.variableTotal).toBeCloseTo(0.002453, 6);
      expect(summary.items.find((i) => i.metric === UsageMetric.IA_TOKENS_ENTRADA)?.billableAmount)
        .toBeCloseTo(0.002132, 6);
    });

    it("não arredonda cada métrica antes de somar — o erro se acumularia", async () => {
      // Dez métricas de R$ 0,004: arredondando uma a uma dá zero; somando
      // primeiro dá R$ 0,04, que é o valor real.
      const dezMetricas = Array.from({ length: 10 }, (_, i) => ({
        source: UsageSource.IA,
        metric: i % 2 === 0 ? UsageMetric.IA_TOKENS_ENTRADA : UsageMetric.IA_TOKENS_SAIDA,
        quantity: 1,
        providerAmount: 0.004,
        billableAmount: 0.004,
        usageRateId: "r1",
        usageRate: rate,
      }));

      const summary = await serviceWithEntries(dezMetricas)
        .getMonthlySummary("empresa-1", { baseMonthlyPrice: 0 });

      expect(summary.variableTotal).toBeCloseTo(0.04, 6);
      expect(summary.variableTotalCharged).toBe(0.04);
    });

    it("o que vai para a fatura continua em centavos; o resíduo acumula", async () => {
      const summary = await serviceWithEntries(conversaReal)
        .getMonthlySummary("empresa-1", { baseMonthlyPrice: 159.9 });

      // R$ 0,0025 ainda não fecha um centavo, então a fatura é só a mensalidade.
      expect(summary.variableTotalCharged).toBe(0);
      expect(summary.estimatedTotal).toBe(159.9);
      // Mas o valor continua visível e somando.
      expect(summary.variableTotal).toBeGreaterThan(0);
    });
  });

  it("consulta o mês corrente e o anterior para permitir a comparação", async () => {
    const prisma = { usageLedger: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new UsageService(prisma as never);

    const result = await service.getBillingUsage("empresa-1", 159.9);

    expect(prisma.usageLedger.findMany).toHaveBeenCalledTimes(2);
    expect(result.previous).toBeDefined();
    expect(new Date(result.previous.periodStart).getTime()).toBeLessThan(new Date(result.periodStart).getTime());
  });
});
