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

  /** A categoria final pode chegar só no evento de status do provedor. */
  async repriceWhatsAppUsage(params: {
    companyId: string;
    channelId: string;
    providerMessageId: string;
    pricingCategory?: string | null;
    /** false somente quando o BSP confirmou que a mensagem não foi entregue. */
    deliveryConfirmed?: boolean;
    /**
     * A Meta pode isentar uma template utility dentro da janela de serviço,
     * mas o Gupshup ainda tarifa o transporte da mensagem. Portanto `false`
     * remove só a parcela Meta e usa a taxa WHATSAPP_SERVICO como base.
     */
    billable?: boolean;
  }) {
    const externalReference = `whatsapp:${params.providerMessageId}`;
    const existing = await this.db().usageLedger.findUnique({ where: { externalReference } });
    const metric = params.billable === false
      ? UsageMetric.WHATSAPP_SERVICO
      : metricForWhatsAppCategory(params.pricingCategory);
    // O status pode chegar antes de `persistOutbound` terminar. Nesse caso
    // criamos um marcador zerado com a mesma referência: quando a persistência
    // tardia tentar registrar o envio, a idempotência encontra esse marcador e
    // não ressuscita uma cobrança de mensagem que o BSP já recusou.
    if (!existing) {
      const created = await this.recordWhatsAppUsage({
        ...params,
        pricingCategory: params.billable === false ? "service" : params.pricingCategory,
      });
      if (!created || params.deliveryConfirmed !== false) return created;
      return this.db().usageLedger.update({
        where: { id: created.id },
        data: { providerAmount: 0, billableAmount: 0 },
      });
    }
    // Uma linha já sincronizada/faturada é um documento histórico; nunca deve
    // ser reprecificada por callback tardio.
    if (existing.status !== UsageLedgerStatus.PENDENTE) return existing;
    const rate = await this.db().usageRate.findUnique({ where: { metric } });
    const unitSize = Number(rate?.unitSize ?? 1);
    const providerUnitCost = rate?.isActive ? Number(rate.providerUnitCost) : 0;
    const markupPercent = rate?.isActive ? Number(rate.markupPercent) : 0;
    const providerAmount = params.deliveryConfirmed === false
      ? 0
      : roundMoneyPrecision((Number(existing.quantity) / Math.max(unitSize, 0.000001)) * providerUnitCost);
    const billableAmount = params.deliveryConfirmed === false
      ? 0
      : roundMoneyPrecision(providerAmount * (1 + markupPercent / 100));
    if (
      existing.metric === metric
      && Number(existing.providerAmount) === providerAmount
      && Number(existing.billableAmount) === billableAmount
      && existing.usageRateId === (rate?.id ?? null)
    ) return existing;
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

  /**
   * A rota de consumo pode continuar consultando um mês civil, mas a página de
   * cobrança precisa consultar o ciclo contratado (por exemplo, 13/08 a
   * 13/09). Centralizar a escolha aqui evita que cada consumidor monte uma
   * janela levemente diferente e cobre/oculte eventos na troca do ciclo.
   */
  private summaryRange(options?: { reference?: Date; periodStart?: Date | null; periodEnd?: Date | null }) {
    const start = options?.periodStart ? new Date(options.periodStart) : null;
    const end = options?.periodEnd ? new Date(options.periodEnd) : null;
    if (
      start
      && end
      && !Number.isNaN(start.getTime())
      && !Number.isNaN(end.getTime())
      && start.getTime() < end.getTime()
    ) {
      return { start, end };
    }
    return this.monthRange(options?.reference);
  }

  async getMonthlySummary(companyId: string, options?: {
    reference?: Date;
    baseMonthlyPrice?: number;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    /** Mantém o histórico na rota de uso; a fatura atual omite o que já foi quitado. */
    includePaid?: boolean;
  }) {
    const { start, end } = this.summaryRange(options);
    const recordedEntries = await this.db().usageLedger.findMany({
      where: { companyId, createdAt: { gte: start, lt: end } },
      include: { usageRate: true },
      orderBy: { createdAt: "desc" },
    });
    // Uma linha FATURADO continua no razão e no histórico de faturas, mas não
    // pode reaparecer no extrato do ciclo em curso. Sem esse filtro, um
    // pagamento confirmado zerava o topo da tela e deixava IA/WhatsApp como se
    // ainda fossem consumo atual — exatamente a divergência que confunde quem
    // acabou de pagar.
    const entries = options?.includePaid === false
      ? recordedEntries.filter((item: any) => item.status !== UsageLedgerStatus.FATURADO)
      : recordedEntries;
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

    // Consumo que já entrou em alguma cobrança e o subconjunto já quitado. As
    // três situações são diferentes: PENDENTE ainda entra na próxima fatura,
    // SINCRONIZADO está em uma fatura aberta e FATURADO é histórico quitado.
    let invoicedAmount = 0;
    let paidAmount = 0;
    for (const item of entries) {
      const coveredByTrial = Boolean(item.trialCoveredAt);
      // Sem status conhecido, trata como pendente: mostrar o cliente devendo é
      // recuperável, esconder um valor a cobrar não.
      if (!coveredByTrial && Boolean(item.status) && item.status !== UsageLedgerStatus.PENDENTE) {
        invoicedAmount += Number(item.billableAmount);
      }
      if (!coveredByTrial && item.status === UsageLedgerStatus.FATURADO) {
        paidAmount += Number(item.billableAmount);
      }
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
      // Um lançamento já emitido ou pago tem o valor congelado; a ausência de
      // tarifa ativa só exige ação enquanto ele ainda pode entrar em cobrança.
      if (item.status === UsageLedgerStatus.PENDENTE && (!item.usageRateId || !item.usageRate?.isActive)) {
        current.unpriced += 1;
      }
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
    /**
     * Consumo do teste que ainda pode ser cobrado.
     *
     * O gasto do teste entra na fatura de quem assina e é perdoado para quem
     * desiste — então, enquanto o lançamento está PENDENTE, ele é um valor a
     * cobrar na ativação, não um custo já absorvido. Depois de entrar em fatura
     * ele sai desta conta.
     */
    const trialChargeableOnActivation = roundMoneyPrecision(
      entries
        .filter((item: any) => item.trialCoveredAt && item.status === UsageLedgerStatus.PENDENTE)
        .reduce((soma: number, item: any) => soma + Number(item.billableAmount), 0),
    );
    // A fatura é em centavos; o resíduo abaixo disso continua acumulando no
    // razão e entra quando o total passar de um centavo.
    const variableTotalCharged = roundToCents(variableTotal);
    const variableInvoiced = roundMoneyPrecision(invoicedAmount);
    const variablePaid = roundMoneyPrecision(paidAmount);
    // Nunca negativo: um arredondamento não pode fazer o pendente virar crédito.
    const variablePending = roundMoneyPrecision(Math.max(0, variableTotal - invoicedAmount));
    const variablePendingCharged = roundToCents(variablePending);
    // `SINCRONIZADO` ainda está em uma fatura que pode não ter sido paga; só
    // `FATURADO` sai do saldo devido. A página de cobrança pede
    // `includePaid: false`, portanto ali esse histórico nem volta como item.
    const variableOutstanding = roundMoneyPrecision(Math.max(0, variableTotal - paidAmount));
    const variableOutstandingCharged = roundToCents(variableOutstanding);
    const baseMonthlyPrice = Number(options?.baseMonthlyPrice ?? 0);

    return {
      periodStart: start,
      periodEnd: end,
      baseMonthlyPrice: roundToCents(baseMonthlyPrice),
      providerTotal,
      variableTotal,
      variableTotalCharged,
      variableInvoiced,
      variablePaid,
      variablePending,
      variablePendingCharged,
      variableOutstanding,
      variableOutstandingCharged,
      /**
       * Mensalidade ainda devida mais consumo que ainda não foi pago.
       *
       * Consumo sincronizado continua aqui até a fatura ser quitada; consumo
       * FATURADO fica no detalhamento como histórico, mas não é dívida atual.
       */
      estimatedTotal: roundToCents(baseMonthlyPrice + variableOutstandingCharged),
      trialCovered: {
        entries: trialCoveredEntries,
        providerTotal: trialProviderTotal,
        nominalAmount: trialCoveredTotal,
        chargeableOnActivation: trialChargeableOnActivation,
        chargeableOnActivationCharged: roundToCents(trialChargeableOnActivation),
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
   * Resumo do ciclo atual e do anterior para a tela de assinatura. Quando há
   * período de assinatura, ele prevalece ao mês-calendário: pagar no dia 13
   * começa um novo extrato no dia 13, sem reapresentar o que quitou no dia 12.
   */
  async getBillingUsage(
    companyId: string,
    baseMonthlyPrice: number,
    period?: { periodStart?: Date | null; periodEnd?: Date | null },
  ) {
    const periodStart = period?.periodStart ? new Date(period.periodStart) : null;
    const periodEnd = period?.periodEnd ? new Date(period.periodEnd) : null;
    const hasSubscriptionPeriod = Boolean(
      periodStart
      && periodEnd
      && !Number.isNaN(periodStart.getTime())
      && !Number.isNaN(periodEnd.getTime())
      && periodStart.getTime() < periodEnd.getTime(),
    );
    if (hasSubscriptionPeriod && periodStart && periodEnd) {
      const previousStart = new Date(periodStart);
      previousStart.setMonth(previousStart.getMonth() - 1);
      const [current, previous] = await Promise.all([
        this.getMonthlySummary(companyId, {
          baseMonthlyPrice,
          periodStart,
          periodEnd,
          includePaid: false,
        }),
        this.getMonthlySummary(companyId, {
          baseMonthlyPrice,
          periodStart: previousStart,
          periodEnd: periodStart,
          includePaid: false,
        }),
      ]);
      return { ...current, previous };
    }
    const now = new Date();
    const previousReference = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const [current, previous] = await Promise.all([
      this.getMonthlySummary(companyId, { baseMonthlyPrice, includePaid: false }),
      this.getMonthlySummary(companyId, { baseMonthlyPrice, reference: previousReference, includePaid: false }),
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
    case "marketing_lite":
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
