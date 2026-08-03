import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CashMovementType,
  CashSessionStatus,
  OrderStatus,
  PaymentMethod,
} from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";

/**
 * Controle de caixa.
 *
 * O problema que resolve: existe `PaymentMethod.DINHEIRO`, mas não havia como
 * fechar o dia. Sem abertura, sangria e conferência, "quanto deveria ter na
 * gaveta" era um número que ninguém conseguia produzir — e diferença de caixa
 * só aparece no fim do mês, quando já não dá para reconstruir.
 *
 * Duas decisões importam:
 *
 * - **Um turno por ponto de venda.** Balcão e delivery fecham separado; somar
 *   os dois torna a conferência inútil, porque a diferença não tem dono.
 * - **Os valores esperados são congelados no fechamento.** Recalcular depois
 *   daria número diferente se um pedido fosse editado, e a conferência precisa
 *   ser uma foto do momento em que a gaveta foi contada.
 */
/**
 * Resultado apurado de um turno, em reais.
 *
 * É o que fica congelado em `CashSession.summary` no fechamento e o que a tela
 * exibe. `margin.available` existe porque margem sem custo cadastrado é número
 * inventado: quando falta custo em algum item, o campo vem nulo e a tela diz o
 * porquê, em vez de mostrar uma margem inflada.
 */
/** Soma em centavos e volta para reais: somar reais acumula erro de float. */
function soma(valores: number[]) {
  return valores.reduce((total, valor) => total + Math.round(valor * 100), 0) / 100;
}

export interface SessionSummary {
  expected: { cash: number; card: number; pix: number };
  sales: {
    total: number;
    products: number;
    delivery: number;
    discount: number;
    orderCount: number;
    averageTicket: number;
  };
  margin: {
    available: boolean;
    cost: number;
    grossProfit: number | null;
    grossMarginPercent: number | null;
    itemsWithoutCost: number;
    itemsTotal: number;
  };
  losses: {
    cancelled: number;
    cancelledCount: number;
    unpaid: number;
    unpaidCount: number;
  };
  /** Totais de sangria e suprimento. Nome distinto da lista de movimentações. */
  cashFlow: { supply: number; withdrawal: number };
}

@Injectable()
export class CashService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  // -------------------------------------------------------------------------
  // Pontos de venda
  // -------------------------------------------------------------------------

  listRegisters(companyId: string) {
    return this.db().cashRegister.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: {
        sessions: {
          where: { status: CashSessionStatus.ABERTO },
          take: 1,
          orderBy: { openedAt: "desc" },
        },
      },
    });
  }

  async createRegister(companyId: string, name: string) {
    const existente = await this.db().cashRegister.findFirst({ where: { companyId, name: name.trim() } });
    if (existente) throw new ConflictException("Já existe um caixa com este nome.");
    return this.db().cashRegister.create({ data: { companyId, name: name.trim() } });
  }

  async updateRegister(companyId: string, id: string, data: { name?: string; isActive?: boolean }) {
    const registro = await this.db().cashRegister.findFirst({ where: { id, companyId } });
    if (!registro) throw new NotFoundException("Caixa não encontrado.");
    if (data.isActive === false) {
      const aberto = await this.db().cashSession.count({
        where: { cashRegisterId: id, status: CashSessionStatus.ABERTO },
      });
      if (aberto > 0) throw new ConflictException("Feche o turno antes de desativar este caixa.");
    }
    return this.db().cashRegister.update({
      where: { id },
      data: { name: data.name?.trim(), isActive: data.isActive },
    });
  }

  // -------------------------------------------------------------------------
  // Turno
  // -------------------------------------------------------------------------

  /**
   * Abre um turno.
   *
   * A reivindicação é condicional (`createMany` seria permissivo demais): dois
   * operadores abrindo ao mesmo tempo criariam dois turnos no mesmo caixa, e
   * cada venda cairia num deles de forma imprevisível.
   */
  async openSession(companyId: string, userId: string, input: { cashRegisterId: string; openingAmount: number }) {
    const registro = await this.db().cashRegister.findFirst({
      where: { id: input.cashRegisterId, companyId, isActive: true },
    });
    if (!registro) throw new NotFoundException("Caixa não encontrado ou inativo.");
    if (input.openingAmount < 0) throw new BadRequestException("O valor de abertura não pode ser negativo.");

    const aberto = await this.db().cashSession.findFirst({
      where: { cashRegisterId: input.cashRegisterId, status: CashSessionStatus.ABERTO },
    });
    if (aberto) throw new ConflictException("Este caixa já tem um turno aberto.");

    try {
      return await this.db().cashSession.create({
        data: {
          companyId,
          cashRegisterId: input.cashRegisterId,
          openingAmount: input.openingAmount,
          openedByUserId: userId,
        },
      });
    } catch {
      throw new ConflictException("Não foi possível abrir o turno. Atualize a tela e tente novamente.");
    }
  }

  async currentSession(companyId: string, cashRegisterId: string) {
    return this.db().cashSession.findFirst({
      where: { companyId, cashRegisterId, status: CashSessionStatus.ABERTO },
      include: { movements: { orderBy: { createdAt: "desc" } }, cashRegister: true },
    });
  }

  /**
   * Sangria e suprimento.
   *
   * Sangria sem registro é a origem clássica da diferença de caixa: o dinheiro
   * sai para o cofre e ninguém anota, aí falta na conferência. Por isso o
   * motivo é obrigatório e o valor é sempre positivo — o sinal vem do tipo.
   */
  async addMovement(
    companyId: string,
    userId: string,
    sessionId: string,
    input: { type: CashMovementType; amount: number; reason: string },
  ) {
    if (input.amount <= 0) throw new BadRequestException("O valor precisa ser maior que zero.");
    if (input.reason.trim().length < 3) throw new BadRequestException("Descreva o motivo da movimentação.");

    const sessao = await this.db().cashSession.findFirst({
      where: { id: sessionId, companyId, status: CashSessionStatus.ABERTO },
    });
    if (!sessao) throw new NotFoundException("Turno não encontrado ou já fechado.");

    if (input.type === CashMovementType.SANGRIA) {
      const disponivel = await this.expectedCashCents(companyId, sessao);
      if (Math.round(input.amount * 100) > disponivel) {
        throw new BadRequestException(
          `A sangria de R$ ${input.amount.toFixed(2)} é maior que os R$ ${(disponivel / 100).toFixed(2)} `
          + "em dinheiro no caixa.",
        );
      }
    }

    return this.db().cashMovement.create({
      data: {
        companyId,
        cashSessionId: sessionId,
        type: input.type,
        amount: input.amount,
        reason: input.reason.trim(),
        createdByUserId: userId,
      },
    });
  }

  /**
   * Fecha o turno com conferência.
   *
   * O claim é atômico porque fechar duas vezes gravaria dois valores contados
   * diferentes para o mesmo turno — e o segundo apagaria a evidência do
   * primeiro.
   */
  async closeSession(
    companyId: string,
    userId: string,
    sessionId: string,
    input: { countedAmount: number; notes?: string },
  ) {
    const sessao = await this.db().cashSession.findFirst({ where: { id: sessionId, companyId } });
    if (!sessao) throw new NotFoundException("Turno não encontrado.");
    if (sessao.status === CashSessionStatus.FECHADO) throw new ConflictException("Este turno já foi fechado.");
    if (input.countedAmount < 0) throw new BadRequestException("O valor contado não pode ser negativo.");

    // A apuração acontece com o turno ainda aberto e vira documento: é o
    // resultado daquele expediente, não uma consulta que se refaz.
    const bruto = await this.summarize(companyId, { ...sessao, closedAt: new Date() });
    const resumo = this.toSummary(bruto);
    const contadoCents = Math.round(input.countedAmount * 100);

    const claimed = await this.db().cashSession.updateMany({
      where: { id: sessionId, status: CashSessionStatus.ABERTO },
      data: {
        status: CashSessionStatus.FECHADO,
        countedAmount: input.countedAmount,
        expectedCash: bruto.expectedCashCents / 100,
        expectedCard: bruto.cartaoCents / 100,
        expectedPix: bruto.pixCents / 100,
        summary: resumo as any,
        difference: (contadoCents - bruto.expectedCashCents) / 100,
        notes: input.notes?.trim() || null,
        closedByUserId: userId,
        closedAt: new Date(),
      },
    });
    if (claimed.count !== 1) throw new ConflictException("Este turno já foi fechado por outra pessoa.");

    return this.report(companyId, sessionId);
  }

  /**
   * Resultado do turno.
   *
   * Turno fechado devolve a fotografia guardada no fechamento; turno aberto
   * calcula agora. Não é otimização: refazer a conta de um turno fechado daria
   * outro número se um pedido fosse editado depois, e a conferência de caixa
   * precisa ser o que foi contado naquele momento.
   */
  async report(companyId: string, sessionId: string) {
    const sessao = await this.db().cashSession.findFirst({
      where: { id: sessionId, companyId },
      include: { movements: { orderBy: { createdAt: "asc" } }, cashRegister: true },
    });
    if (!sessao) throw new NotFoundException("Turno não encontrado.");

    const resumo = sessao.status === CashSessionStatus.FECHADO && sessao.summary
      ? (sessao.summary as SessionSummary)
      : this.toSummary(await this.summarize(companyId, sessao));

    return this.toReport(sessao, resumo);
  }

  private toReport(sessao: any, resumo: SessionSummary) {
    return {
      id: sessao.id,
      status: sessao.status,
      cashRegister: { id: sessao.cashRegister?.id, name: sessao.cashRegister?.name },
      openedAt: sessao.openedAt,
      closedAt: sessao.closedAt,
      openingAmount: Number(sessao.openingAmount),
      countedAmount: sessao.countedAmount === null ? null : Number(sessao.countedAmount),
      difference: sessao.difference === null ? null : Number(sessao.difference),
      notes: sessao.notes,
      ...resumo,
      movements: (sessao.movements ?? []).map((movimento: any) => ({
        id: movimento.id,
        type: movimento.type,
        amount: Number(movimento.amount),
        reason: movimento.reason,
        createdAt: movimento.createdAt,
      })),
    };
  }

  /**
   * Histórico de turnos fechados.
   *
   * Devolve o resumo congelado de cada um, não só as datas: a tela de histórico
   * existe para comparar dias, e obrigar a abrir turno por turno para ver o
   * faturamento tornaria a comparação inviável.
   */
  async listSessions(
    companyId: string,
    filters: { from?: Date; to?: Date; cashRegisterId?: string; status?: CashSessionStatus } = {},
  ) {
    const where: any = { companyId };
    if (filters.cashRegisterId) where.cashRegisterId = filters.cashRegisterId;
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.openedAt = {};
      if (filters.from) where.openedAt.gte = filters.from;
      // Intervalo semiaberto: `lt` no início do dia seguinte, para não perder
      // as vendas do último minuto nem incluir as do dia seguinte.
      if (filters.to) where.openedAt.lt = filters.to;
    }

    const sessoes = await this.db().cashSession.findMany({
      where,
      orderBy: { openedAt: "desc" },
      take: 100,
      include: { cashRegister: { select: { id: true, name: true } }, movements: true },
    });

    const itens = sessoes.map((sessao: any) => {
      const resumo = sessao.summary as SessionSummary | null;
      return {
        id: sessao.id,
        status: sessao.status,
        cashRegister: sessao.cashRegister,
        openedAt: sessao.openedAt,
        closedAt: sessao.closedAt,
        openingAmount: Number(sessao.openingAmount),
        countedAmount: sessao.countedAmount === null ? null : Number(sessao.countedAmount),
        difference: sessao.difference === null ? null : Number(sessao.difference),
        notes: sessao.notes,
        // Turnos fechados antes desta funcionalidade não têm resumo. Devolver
        // nulo e dizer isso na tela é honesto; recalcular agora daria um número
        // diferente do que foi conferido na época.
        summary: resumo,
      };
    });

    const fechados = itens.filter((item: any) => item.summary);
    const totais = {
      sessions: itens.length,
      revenue: soma(fechados.map((i: any) => i.summary.sales.total)),
      orderCount: fechados.reduce((s: number, i: any) => s + i.summary.sales.orderCount, 0),
      cancelled: soma(fechados.map((i: any) => i.summary.losses.cancelled)),
      difference: soma(itens.filter((i: any) => i.difference !== null).map((i: any) => i.difference)),
      withdrawals: soma(fechados.map((i: any) => i.summary.cashFlow.withdrawal)),
      grossProfit: fechados.every((i: any) => i.summary.margin.available) && fechados.length > 0
        ? soma(fechados.map((i: any) => i.summary.margin.grossProfit ?? 0))
        : null,
    };

    return { items: itens, totals: totais };
  }

  /**
   * Apura o turno.
   *
   * Três decisões que mudam o número:
   *
   * 1. **Só pedido pago e não cancelado conta.** Pedido em aberto ainda não pôs
   *    dinheiro na gaveta; somá-lo produziria falta na conferência.
   * 2. **Só dinheiro entra na conferência física.** Cartão e Pix aparecem no
   *    faturamento, mas não são contados na gaveta.
   * 3. **O custo vem de `unitCost`, fotografado na venda** — não do custo atual
   *    do produto. Consultar o custo de hoje reescreveria a margem de um mês
   *    fechado a cada atualização de compra.
   *
   * O que o sistema **não** calcula: lucro líquido. Aluguel, folha, energia e
   * impostos não passam por aqui, então o que se apura é margem bruta. Chamar
   * isso de lucro seria mentir num número que alguém usa para formar preço.
   */
  private async summarize(companyId: string, sessao: any) {
    const janela: any = { gte: sessao.openedAt };
    if (sessao.closedAt) janela.lt = sessao.closedAt;

    const pedidos = await this.db().order.findMany({
      where: { companyId, createdAt: janela },
      select: {
        paymentMethod: true,
        paymentStatus: true,
        status: true,
        total: true,
        deliveryFee: true,
        discount: true,
        items: { select: { quantity: true, unitCost: true, totalPrice: true } },
      },
    });

    let dinheiroCents = 0;
    let cartaoCents = 0;
    let pixCents = 0;
    let produtosCents = 0;
    let entregaCents = 0;
    let descontoCents = 0;
    let custoCents = 0;
    let itensSemCusto = 0;
    let itensTotal = 0;
    let pagos = 0;
    let canceladosCents = 0;
    let cancelados = 0;
    let emAbertoCents = 0;
    let emAberto = 0;

    for (const pedido of pedidos) {
      const totalCents = Math.round(Number(pedido.total) * 100);

      if (pedido.status === OrderStatus.CANCELADO) {
        canceladosCents += totalCents;
        cancelados += 1;
        continue;
      }
      if (pedido.paymentStatus !== "PAGO") {
        emAbertoCents += totalCents;
        emAberto += 1;
        continue;
      }

      pagos += 1;
      if (pedido.paymentMethod === PaymentMethod.DINHEIRO) dinheiroCents += totalCents;
      else if (pedido.paymentMethod === PaymentMethod.CARTAO_ENTREGA) cartaoCents += totalCents;
      else if (pedido.paymentMethod === PaymentMethod.PIX_MANUAL) pixCents += totalCents;

      entregaCents += Math.round(Number(pedido.deliveryFee) * 100);
      descontoCents += Math.round(Number(pedido.discount) * 100);

      for (const item of pedido.items) {
        itensTotal += 1;
        produtosCents += Math.round(Number(item.totalPrice) * 100);
        if (item.unitCost === null || item.unitCost === undefined) {
          itensSemCusto += 1;
          continue;
        }
        custoCents += Math.round(Number(item.unitCost) * 100) * Number(item.quantity);
      }
    }

    const movimentos = await this.db().cashMovement.findMany({
      where: { cashSessionId: sessao.id },
      select: { type: true, amount: true },
    });
    let suprimentoCents = 0;
    let sangriaCents = 0;
    for (const movimento of movimentos) {
      const cents = Math.round(Number(movimento.amount) * 100);
      if (movimento.type === CashMovementType.SANGRIA) sangriaCents += cents;
      else suprimentoCents += cents;
    }

    const vendasCents = dinheiroCents + cartaoCents + pixCents;

    return {
      dinheiroCents,
      cartaoCents,
      pixCents,
      vendasCents,
      produtosCents,
      entregaCents,
      descontoCents,
      custoCents,
      itensSemCusto,
      itensTotal,
      pagos,
      canceladosCents,
      cancelados,
      emAbertoCents,
      emAberto,
      suprimentoCents,
      sangriaCents,
      // Só o dinheiro fica na gaveta.
      expectedCashCents: Math.round(Number(sessao.openingAmount) * 100)
        + dinheiroCents + suprimentoCents - sangriaCents,
    };
  }

  /** Converte a apuração em centavos no documento em reais que vai para a tela. */
  private toSummary(bruto: Awaited<ReturnType<CashService["summarize"]>>): SessionSummary {
    const reais = (cents: number) => Math.round(cents) / 100;
    // Margem só faz sentido se houver custo em todos os itens: com metade dos
    // produtos sem custo cadastrado, a margem sairia inflada e pareceria ótima.
    const custoCompleto = bruto.itensTotal > 0 && bruto.itensSemCusto === 0;
    const margemCents = bruto.produtosCents - bruto.custoCents;

    return {
      expected: {
        cash: reais(bruto.expectedCashCents),
        card: reais(bruto.cartaoCents),
        pix: reais(bruto.pixCents),
      },
      sales: {
        total: reais(bruto.vendasCents),
        products: reais(bruto.produtosCents),
        delivery: reais(bruto.entregaCents),
        discount: reais(bruto.descontoCents),
        orderCount: bruto.pagos,
        averageTicket: bruto.pagos > 0 ? reais(Math.round(bruto.vendasCents / bruto.pagos)) : 0,
      },
      margin: {
        available: custoCompleto,
        cost: reais(bruto.custoCents),
        grossProfit: custoCompleto ? reais(margemCents) : null,
        grossMarginPercent: custoCompleto && bruto.produtosCents > 0
          ? Math.round((margemCents / bruto.produtosCents) * 1000) / 10
          : null,
        itemsWithoutCost: bruto.itensSemCusto,
        itemsTotal: bruto.itensTotal,
      },
      losses: {
        cancelled: reais(bruto.canceladosCents),
        cancelledCount: bruto.cancelados,
        unpaid: reais(bruto.emAbertoCents),
        unpaidCount: bruto.emAberto,
      },
      cashFlow: {
        supply: reais(bruto.suprimentoCents),
        withdrawal: reais(bruto.sangriaCents),
      },
    };
  }

  private async expectedCashCents(companyId: string, sessao: any) {
    return (await this.summarize(companyId, sessao)).expectedCashCents;
  }
}
