import { Inject, Injectable } from "@nestjs/common";
import { SubscriptionStatus, UsageLedgerStatus, UsageMetric, UsageSource } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { UpdateUsageRateDto } from "./dto/update-usage-rate.dto";

const METRIC_LABELS: Record<UsageMetric, string> = {
  IA_TOKENS_ENTRADA: "IA — tokens de entrada",
  IA_TOKENS_ENTRADA_CACHE: "IA — tokens de entrada com cache",
  IA_TOKENS_SAIDA: "IA — tokens de saída",
  WHATSAPP_SERVICO: "WhatsApp — mensagem de serviço",
  WHATSAPP_TEMPLATE_UTILIDADE: "WhatsApp — template de utilidade",
  WHATSAPP_TEMPLATE_MARKETING: "WhatsApp — template de marketing",
  WHATSAPP_TEMPLATE_AUTENTICACAO: "WhatsApp — template de autenticação",
};

const SOURCE_LABELS: Record<UsageSource, string> = {
  IA: "Inteligência artificial",
  WHATSAPP: "WhatsApp",
};

export type UsageRecordInput = {
  companyId: string;
  channelId?: string | null;
  source: UsageSource;
  metric: UsageMetric;
  quantity: number;
  externalReference?: string | null;
  createdAt?: Date;
};

@Injectable()
export class UsageService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  async listRates() {
    return this.db().usageRate.findMany({ orderBy: { metric: "asc" } });
  }

  async updateRate(dto: UpdateUsageRateDto) {
    return this.db().usageRate.upsert({
      where: { metric: dto.metric },
      create: {
        metric: dto.metric,
        provider: dto.provider.trim(),
        label: dto.label.trim(),
        unitSize: dto.unitSize,
        providerUnitCost: dto.providerUnitCost,
        markupPercent: dto.markupPercent,
        isActive: dto.isActive ?? true,
      },
      update: {
        provider: dto.provider.trim(),
        label: dto.label.trim(),
        unitSize: dto.unitSize,
        providerUnitCost: dto.providerUnitCost,
        markupPercent: dto.markupPercent,
        isActive: dto.isActive,
      },
    });
  }

  /**
   * Persiste o consumo com o preço que estava ativo no instante do evento. Isso
   * torna a fatura reproduzível mesmo se o Meta/LLM alterar seus preços depois.
   */
  async record(input: UsageRecordInput) {
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;

    if (input.externalReference) {
      const existing = await this.db().usageLedger.findUnique({
        where: { externalReference: input.externalReference },
      });
      if (existing) return existing;
    }

    const rate = await this.db().usageRate.findUnique({ where: { metric: input.metric } });
    const unitSize = Number(rate?.unitSize ?? 1);
    const providerUnitCost = rate?.isActive ? Number(rate.providerUnitCost) : 0;
    const markupPercent = rate?.isActive ? Number(rate.markupPercent) : 0;
    const providerAmount = roundMoneyPrecision((quantity / Math.max(unitSize, 0.000001)) * providerUnitCost);
    const billableAmount = roundMoneyPrecision(providerAmount * (1 + markupPercent / 100));
    const occurredAt = input.createdAt ?? new Date();
    const trialCoveredAt = await this.trialCoverageAt(input.companyId, occurredAt);

    try {
      return await this.db().usageLedger.create({
        data: {
          companyId: input.companyId,
          channelId: input.channelId ?? null,
          usageRateId: rate?.id ?? null,
          source: input.source,
          metric: input.metric,
          quantity,
          providerAmount,
          billableAmount,
          externalReference: input.externalReference ?? null,
          trialCoveredAt,
          createdAt: occurredAt,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error) && input.externalReference) {
        return this.db().usageLedger.findUnique({ where: { externalReference: input.externalReference } });
      }
      throw error;
    }
  }

  async recordAiUsage(params: {
    companyId: string;
    inputTokens?: number | null;
    cachedInputTokens?: number | null;
    uncachedInputTokens?: number | null;
    outputTokens?: number | null;
    requestId?: string | null;
  }) {
    const reference = params.requestId?.trim() || null;
    const inputTokens = nonNegativeNumber(params.inputTokens);
    const cachedInputTokens = Math.min(nonNegativeNumber(params.cachedInputTokens), inputTokens);
    // A API do DeepSeek informa a divisão cache hit/cache miss. Quando um
    // provedor futuro não a expuser, o total de entrada é conservadoramente
    // contabilizado como sem cache, sem perder nenhum token da chamada.
    const uncachedInputTokens = params.uncachedInputTokens == null
      ? Math.max(0, inputTokens - cachedInputTokens)
      : Math.min(nonNegativeNumber(params.uncachedInputTokens), Math.max(0, inputTokens - cachedInputTokens));
    const [input, cachedInput, output] = await Promise.all([
      this.record({
        companyId: params.companyId,
        source: UsageSource.IA,
        metric: UsageMetric.IA_TOKENS_ENTRADA,
        quantity: uncachedInputTokens,
        externalReference: reference ? `ai:${reference}:input` : null,
      }),
      this.record({
        companyId: params.companyId,
        source: UsageSource.IA,
        metric: UsageMetric.IA_TOKENS_ENTRADA_CACHE,
        quantity: cachedInputTokens,
        externalReference: reference ? `ai:${reference}:cache-hit` : null,
      }),
      this.record({
        companyId: params.companyId,
        source: UsageSource.IA,
        metric: UsageMetric.IA_TOKENS_SAIDA,
        quantity: Number(params.outputTokens ?? 0),
        externalReference: reference ? `ai:${reference}:output` : null,
      }),
    ]);
    return { input, cachedInput, output };
  }

  async recordWhatsAppUsage(params: {
    companyId: string;
    channelId: string;
    providerMessageId?: string | null;
    pricingCategory?: string | null;
  }) {
    const metric = metricForWhatsAppCategory(params.pricingCategory);
    return this.record({
      companyId: params.companyId,
      channelId: params.channelId,
      source: UsageSource.WHATSAPP,
      metric,
      quantity: 1,
      externalReference: params.providerMessageId ? `whatsapp:${params.providerMessageId}` : null,
    });
  }

  /** A Meta pode informar a categoria final apenas no webhook de status. */
  async repriceWhatsAppUsage(params: {
    companyId: string;
    channelId: string;
    providerMessageId: string;
    pricingCategory?: string | null;
    billable?: boolean;
  }) {
    const externalReference = `whatsapp:${params.providerMessageId}`;
    const existing = await this.db().usageLedger.findUnique({ where: { externalReference } });
    if (!existing) return this.recordWhatsAppUsage(params);
    const metric = metricForWhatsAppCategory(params.pricingCategory);
    if (existing.metric === metric || existing.status !== UsageLedgerStatus.PENDENTE) return existing;
    const rate = await this.db().usageRate.findUnique({ where: { metric } });
    const unitSize = Number(rate?.unitSize ?? 1);
    const providerUnitCost = rate?.isActive ? Number(rate.providerUnitCost) : 0;
    const markupPercent = rate?.isActive ? Number(rate.markupPercent) : 0;
    const providerAmount = params.billable === false
      ? 0
      : roundMoneyPrecision((Number(existing.quantity) / Math.max(unitSize, 0.000001)) * providerUnitCost);
    const billableAmount = params.billable === false
      ? 0
      : roundMoneyPrecision(providerAmount * (1 + markupPercent / 100));
    return this.db().usageLedger.update({
      where: { id: existing.id },
      data: {
        usageRateId: rate?.id ?? null,
        metric,
        providerAmount,
        billableAmount,
      },
    });
  }

  monthRange(reference = new Date()) {
    const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
    const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
    return { start, end };
  }

  async getMonthlySummary(companyId: string, options?: { reference?: Date; baseMonthlyPrice?: number }) {
    const { start, end } = this.monthRange(options?.reference);
    const entries = await this.db().usageLedger.findMany({
      where: { companyId, createdAt: { gte: start, lt: end } },
      include: { usageRate: true },
      orderBy: { createdAt: "desc" },
    });
    const grouped = new Map<UsageMetric, {
      quantity: number;
      providerAmount: number;
      billableAmount: number;
      trialQuantity: number;
      trialProviderAmount: number;
      trialCoveredAmount: number;
      unpriced: number;
    }>();
    const bySource = new Map<UsageSource, {
      quantity: number;
      providerAmount: number;
      billableAmount: number;
      trialQuantity: number;
      trialProviderAmount: number;
      trialCoveredAmount: number;
    }>();

    for (const item of entries) {
      const coveredByTrial = Boolean(item.trialCoveredAt);
      const sourceTotals = bySource.get(item.source) ?? {
        quantity: 0,
        providerAmount: 0,
        billableAmount: 0,
        trialQuantity: 0,
        trialProviderAmount: 0,
        trialCoveredAmount: 0,
      };
      sourceTotals.quantity += Number(item.quantity);
      sourceTotals.providerAmount += Number(item.providerAmount);
      if (coveredByTrial) {
        sourceTotals.trialQuantity += Number(item.quantity);
        sourceTotals.trialProviderAmount += Number(item.providerAmount);
        sourceTotals.trialCoveredAmount += Number(item.billableAmount);
      } else {
        sourceTotals.billableAmount += Number(item.billableAmount);
      }
      bySource.set(item.source, sourceTotals);

      const current = grouped.get(item.metric) ?? {
        quantity: 0,
        providerAmount: 0,
        billableAmount: 0,
        trialQuantity: 0,
        trialProviderAmount: 0,
        trialCoveredAmount: 0,
        unpriced: 0,
      };
      current.quantity += Number(item.quantity);
      current.providerAmount += Number(item.providerAmount);
      if (coveredByTrial) {
        current.trialQuantity += Number(item.quantity);
        current.trialProviderAmount += Number(item.providerAmount);
        current.trialCoveredAmount += Number(item.billableAmount);
      } else {
        current.billableAmount += Number(item.billableAmount);
      }
      if (!item.usageRateId || !item.usageRate?.isActive) current.unpriced += 1;
      grouped.set(item.metric, current);
    }

    /**
     * Os valores saem em precisão de milionésimo, não arredondados a centavo.
     *
     * Arredondar cada métrica antes de somar zerava tudo que custa menos de um
     * centavo — e é exatamente esse o custo de uma conversa de IA. Três mil
     * tokens de entrada custam R$ 0,0021: arredondado vira R$ 0,00, e o
     * lojista vê "0,00" ao lado de "3,3 mil tokens" achando que o sistema não
     * contabilizou. Além de esconder, o arredondamento por item perdia até
     * meio centavo por métrica a cada leitura.
     *
     * Quem decide quantas casas mostrar é a tela; o que vai para a fatura é
     * `variableTotalCharged`, esse sim em centavos.
     */
    const items = Array.from(grouped.entries()).map(([metric, values]) => ({
      metric,
      label: METRIC_LABELS[metric],
      ...values,
      providerAmount: roundMoneyPrecision(values.providerAmount),
      billableAmount: roundMoneyPrecision(values.billableAmount),
      trialProviderAmount: roundMoneyPrecision(values.trialProviderAmount),
      trialCoveredAmount: roundMoneyPrecision(values.trialCoveredAmount),
    }));
    const providerTotal = roundMoneyPrecision(items.reduce((sum, item) => sum + item.providerAmount, 0));
    const variableTotal = roundMoneyPrecision(items.reduce((sum, item) => sum + item.billableAmount, 0));
    const trialProviderTotal = roundMoneyPrecision(items.reduce((sum, item) => sum + item.trialProviderAmount, 0));
    const trialCoveredTotal = roundMoneyPrecision(items.reduce((sum, item) => sum + item.trialCoveredAmount, 0));
    const trialCoveredEntries = entries.filter((item: any) => item.trialCoveredAt).length;
    // A fatura é em centavos; o resíduo abaixo disso continua acumulando no
    // razão e entra quando o total passar de um centavo.
    const variableTotalCharged = roundToCents(variableTotal);
    const baseMonthlyPrice = Number(options?.baseMonthlyPrice ?? 0);

    return {
      periodStart: start,
      periodEnd: end,
      baseMonthlyPrice: roundToCents(baseMonthlyPrice),
      providerTotal,
      variableTotal,
      variableTotalCharged,
      estimatedTotal: roundToCents(baseMonthlyPrice + variableTotalCharged),
      trialCovered: {
        entries: trialCoveredEntries,
        providerTotal: trialProviderTotal,
        nominalAmount: trialCoveredTotal,
      },
      unpricedEvents: items.reduce((sum, item) => sum + item.unpriced, 0),
      items,
      /**
       * Subtotais por origem. IA e WhatsApp têm ordens de grandeza e unidades
       * diferentes (tokens x mensagens), então somá-los num número só esconde
       * qual dos dois está puxando a conta.
       */
      sources: Object.values(UsageSource).map((source) => {
        const totals = bySource.get(source) ?? {
          quantity: 0,
          providerAmount: 0,
          billableAmount: 0,
          trialQuantity: 0,
          trialProviderAmount: 0,
          trialCoveredAmount: 0,
        };
        return {
          source,
          label: SOURCE_LABELS[source],
          quantity: totals.quantity,
          providerAmount: roundMoneyPrecision(totals.providerAmount),
          billableAmount: roundMoneyPrecision(totals.billableAmount),
          trialQuantity: totals.trialQuantity,
          trialProviderAmount: roundMoneyPrecision(totals.trialProviderAmount),
          trialCoveredAmount: roundMoneyPrecision(totals.trialCoveredAmount),
        };
      }),
    };
  }

  /**
   * Resumo do mês corrente e do anterior, para a tela de assinatura conseguir
   * mostrar a variação — que é o que responde "por que a conta subiu?".
   */
  async getBillingUsage(companyId: string, baseMonthlyPrice: number) {
    const now = new Date();
    const previousReference = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const [current, previous] = await Promise.all([
      this.getMonthlySummary(companyId, { baseMonthlyPrice }),
      this.getMonthlySummary(companyId, { baseMonthlyPrice, reference: previousReference }),
    ]);
    return { ...current, previous };
  }

  async pendingBillableEntries(companyId?: string) {
    return this.db().usageLedger.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: UsageLedgerStatus.PENDENTE,
        billableAmount: { gt: 0 },
        trialCoveredAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async markSynchronized(id: string, stripeInvoiceItemId: string) {
    return this.db().usageLedger.update({
      where: { id },
      data: { status: UsageLedgerStatus.SINCRONIZADO, stripeInvoiceItemId },
    });
  }

  async markInvoicePaid(stripeInvoiceId: string) {
    return this.db().usageLedger.updateMany({
      where: { stripeInvoiceId, status: UsageLedgerStatus.SINCRONIZADO },
      data: { status: UsageLedgerStatus.FATURADO },
    });
  }

  /**
   * A tarifa é calculada e registrada durante o teste para auditoria, mas a
   * marca de cobertura é aplicada no instante do evento. Assim, uma empresa
   * que ative o plano depois não recebe na fatura nenhum uso dos sete dias.
   */
  private async trialCoverageAt(companyId: string, occurredAt: Date) {
    // O client Prisma sempre expõe este modelo; a guarda também mantém os
    // testes unitários de precificação independentes de um mock de assinatura.
    if (!this.db().clientSubscription?.findUnique) return null;
    const subscription = await this.db().clientSubscription.findUnique({
      where: { companyId },
      select: { status: true, trialStartedAt: true, trialEndsAt: true },
    });
    if (
      subscription?.status !== SubscriptionStatus.EM_TESTE
      || !subscription.trialEndsAt
      || subscription.trialEndsAt <= occurredAt
      || (subscription.trialStartedAt && subscription.trialStartedAt > occurredAt)
    ) {
      return null;
    }
    return occurredAt;
  }
}

function metricForWhatsAppCategory(category?: string | null): UsageMetric {
  switch (String(category ?? "").toLowerCase()) {
    case "utility":
      return UsageMetric.WHATSAPP_TEMPLATE_UTILIDADE;
    case "marketing":
      return UsageMetric.WHATSAPP_TEMPLATE_MARKETING;
    case "authentication":
      return UsageMetric.WHATSAPP_TEMPLATE_AUTENTICACAO;
    default:
      return UsageMetric.WHATSAPP_SERVICO;
  }
}

function roundMoneyPrecision(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundToCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nonNegativeNumber(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isUniqueConstraint(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: string }).code === "P2002";
}
