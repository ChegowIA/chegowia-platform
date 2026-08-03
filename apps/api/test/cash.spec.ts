import { CashMovementType, CashSessionStatus, OrderStatus, PaymentMethod } from "@prisma/client";
import { CashService } from "../src/cash/cash.service";

/**
 * O caixa existe para produzir um número que ninguém conseguia produzir antes:
 * quanto deveria haver na gaveta. Os testes cobrem justamente onde esse número
 * costuma sair errado — sangria não registrada, pedido não pago somado, e
 * fechamento executado duas vezes.
 */
describe("caixa", () => {
  const turnoAberto = {
    id: "turno-1",
    companyId: "empresa-1",
    cashRegisterId: "caixa-1",
    status: CashSessionStatus.ABERTO,
    openingAmount: 100,
    openedAt: new Date("2026-08-02T08:00:00-03:00"),
    closedAt: null,
    cashRegister: { id: "caixa-1", name: "Balcão" },
  };

  function build(overrides: any = {}) {
    const prisma: any = {
      cashRegister: {
        // `??` trataria `null` como ausente e devolveria o padrão; a chave
        // precisa ser testada por presença para o caso "caixa inativo".
        findFirst: jest.fn().mockResolvedValue(
          "register" in overrides ? overrides.register : { id: "caixa-1", companyId: "empresa-1", isActive: true, name: "Balcão" },
        ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "caixa-1", ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "caixa-1", ...data })),
      },
      cashSession: {
        findFirst: jest.fn().mockResolvedValue(
          overrides.session === undefined ? { ...turnoAberto, movements: [] } : overrides.session,
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(overrides.openCount ?? 0),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "turno-1", ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: overrides.closeClaim ?? 1 }),
      },
      cashMovement: {
        findMany: jest.fn().mockResolvedValue(overrides.movements ?? []),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "mov-1", ...data })),
      },
      order: {
        findMany: jest.fn().mockResolvedValue(
          (overrides.orders ?? []).map((pedido: any) => ({
            paymentStatus: "PAGO",
            status: OrderStatus.ENTREGUE,
            deliveryFee: 0,
            discount: 0,
            items: [],
            ...pedido,
          })),
        ),
      },
    };
    return { service: new CashService(prisma as never), prisma };
  }

  describe("abertura", () => {
    it("recusa abrir um segundo turno no mesmo caixa", async () => {
      const { service } = build();

      await expect(service.openSession("empresa-1", "user-1", { cashRegisterId: "caixa-1", openingAmount: 100 }))
        .rejects.toThrow(/já tem um turno aberto/);
    });

    it("abre quando não há turno em andamento", async () => {
      const { service, prisma } = build({ session: null });

      const turno = await service.openSession("empresa-1", "user-1", { cashRegisterId: "caixa-1", openingAmount: 150 });

      expect(turno.openingAmount).toBe(150);
      expect(prisma.cashSession.create).toHaveBeenCalled();
    });

    it("recusa fundo de troco negativo", async () => {
      const { service } = build({ session: null });

      await expect(service.openSession("empresa-1", "user-1", { cashRegisterId: "caixa-1", openingAmount: -5 }))
        .rejects.toThrow(/negativo/);
    });

    it("caixa inativo não abre turno", async () => {
      const { service } = build({ register: null, session: null });

      await expect(service.openSession("empresa-1", "user-1", { cashRegisterId: "caixa-1", openingAmount: 10 }))
        .rejects.toThrow(/não encontrado ou inativo/);
    });
  });

  describe("cálculo do esperado", () => {
    const vendas = [
      { paymentMethod: PaymentMethod.DINHEIRO, total: 50 },
      { paymentMethod: PaymentMethod.DINHEIRO, total: 30.5 },
      { paymentMethod: PaymentMethod.CARTAO_ENTREGA, total: 80 },
      { paymentMethod: PaymentMethod.PIX_MANUAL, total: 20 },
    ];

    it("só o dinheiro entra no esperado da gaveta", async () => {
      const { service } = build({ orders: vendas });

      const relatorio = await service.report("empresa-1", "turno-1");

      // 100 de abertura + 80,50 em dinheiro.
      expect(relatorio.expected.cash).toBe(180.5);
      expect(relatorio.expected.card).toBe(80);
      expect(relatorio.expected.pix).toBe(20);
      expect(relatorio.sales.total).toBe(180.5);
    });

    it("sangria diminui e suprimento aumenta o esperado", async () => {
      const { service } = build({
        orders: vendas,
        movements: [
          { type: CashMovementType.SANGRIA, amount: 100 },
          { type: CashMovementType.SUPRIMENTO, amount: 40 },
        ],
      });

      const relatorio = await service.report("empresa-1", "turno-1");

      expect(relatorio.expected.cash).toBe(120.5);
    });

    it("cancelado e não pago não entram no faturamento, mas aparecem como perda", async () => {
      // A separação é o ponto: os dois somem do caixa, mas por motivos
      // diferentes, e juntá-los num só número esconderia qual é qual.
      const { service } = build({
        orders: [
          { paymentMethod: PaymentMethod.DINHEIRO, total: 50 },
          { paymentMethod: PaymentMethod.DINHEIRO, total: 999, status: OrderStatus.CANCELADO },
          { paymentMethod: PaymentMethod.DINHEIRO, total: 33, paymentStatus: "PENDENTE" },
        ],
      });

      const relatorio = await service.report("empresa-1", "turno-1");

      expect(relatorio.sales.total).toBe(50);
      expect(relatorio.expected.cash).toBe(150);
      expect(relatorio.losses.cancelled).toBe(999);
      expect(relatorio.losses.cancelledCount).toBe(1);
      expect(relatorio.losses.unpaid).toBe(33);
      expect(relatorio.losses.unpaidCount).toBe(1);
    });

    describe("margem", () => {
      it("calcula lucro bruto quando todo item vendido tem custo", async () => {
        const { service } = build({
          orders: [{
            paymentMethod: PaymentMethod.DINHEIRO,
            total: 100,
            items: [{ quantity: 2, unitCost: 15, totalPrice: 100 }],
          }],
        });

        const relatorio = await service.report("empresa-1", "turno-1");

        expect(relatorio.margin.available).toBe(true);
        expect(relatorio.margin.cost).toBe(30);
        expect(relatorio.margin.grossProfit).toBe(70);
        expect(relatorio.margin.grossMarginPercent).toBe(70);
      });

      it("um único item sem custo torna a margem indisponível, não parcial", async () => {
        // Margem sobre custo incompleto sai inflada e parece confiável — é pior
        // que não mostrar nada.
        const { service } = build({
          orders: [{
            paymentMethod: PaymentMethod.DINHEIRO,
            total: 100,
            items: [
              { quantity: 1, unitCost: 20, totalPrice: 50 },
              { quantity: 1, unitCost: null, totalPrice: 50 },
            ],
          }],
        });

        const relatorio = await service.report("empresa-1", "turno-1");

        expect(relatorio.margin.available).toBe(false);
        expect(relatorio.margin.grossProfit).toBeNull();
        expect(relatorio.margin.itemsWithoutCost).toBe(1);
        expect(relatorio.margin.itemsTotal).toBe(2);
      });

      it("sem venda nenhuma a margem não é anunciada como zero", async () => {
        const { service } = build({ orders: [] });

        const relatorio = await service.report("empresa-1", "turno-1");

        expect(relatorio.margin.available).toBe(false);
        expect(relatorio.margin.itemsTotal).toBe(0);
      });
    });

    it("ticket médio divide o faturamento pelos pedidos pagos", async () => {
      const { service } = build({
        orders: [
          { paymentMethod: PaymentMethod.DINHEIRO, total: 30 },
          { paymentMethod: PaymentMethod.CARTAO_ENTREGA, total: 70 },
          { paymentMethod: PaymentMethod.DINHEIRO, total: 999, status: OrderStatus.CANCELADO },
        ],
      });

      const relatorio = await service.report("empresa-1", "turno-1");

      expect(relatorio.sales.orderCount).toBe(2);
      expect(relatorio.sales.averageTicket).toBe(50);
    });

    it("centavos não se perdem na soma", async () => {
      const { service } = build({
        orders: Array.from({ length: 3 }, () => ({ paymentMethod: PaymentMethod.DINHEIRO, total: 0.1 })),
        session: { ...turnoAberto, openingAmount: 0, movements: [] },
      });

      const relatorio = await service.report("empresa-1", "turno-1");

      expect(relatorio.expected.cash).toBe(0.3);
    });
  });

  describe("movimentações", () => {
    it("sangria maior que o disponível é recusada com o valor real", async () => {
      const { service } = build({ orders: [{ paymentMethod: PaymentMethod.DINHEIRO, total: 50 }] });

      await expect(service.addMovement("empresa-1", "user-1", "turno-1", {
        type: CashMovementType.SANGRIA,
        amount: 500,
        reason: "Levar ao cofre",
      })).rejects.toThrow(/150,00|150.00/);
    });

    it("suprimento não tem limite de saldo", async () => {
      const { service, prisma } = build();

      await service.addMovement("empresa-1", "user-1", "turno-1", {
        type: CashMovementType.SUPRIMENTO,
        amount: 500,
        reason: "Reforço de troco",
      });

      expect(prisma.cashMovement.create).toHaveBeenCalled();
    });

    it("motivo é obrigatório — sangria sem registro é a origem da diferença", async () => {
      const { service } = build();

      await expect(service.addMovement("empresa-1", "user-1", "turno-1", {
        type: CashMovementType.SANGRIA,
        amount: 10,
        reason: "x",
      })).rejects.toThrow(/motivo/);
    });

    it("valor zero ou negativo é recusado", async () => {
      const { service } = build();

      await expect(service.addMovement("empresa-1", "user-1", "turno-1", {
        type: CashMovementType.SUPRIMENTO,
        amount: 0,
        reason: "Nada",
      })).rejects.toThrow(/maior que zero/);
    });

    it("turno fechado não aceita movimentação", async () => {
      const { service } = build({ session: null });

      await expect(service.addMovement("empresa-1", "user-1", "turno-1", {
        type: CashMovementType.SANGRIA,
        amount: 10,
        reason: "Levar ao cofre",
      })).rejects.toThrow(/não encontrado ou já fechado/);
    });
  });

  describe("fechamento", () => {
    it("congela a apuração completa no fechamento", async () => {
      const { service, prisma } = build({
        orders: [{
          paymentMethod: PaymentMethod.DINHEIRO,
          total: 100,
          items: [{ quantity: 1, unitCost: 40, totalPrice: 100 }],
        }],
      });
      prisma.cashSession.findFirst
        .mockResolvedValueOnce({ ...turnoAberto })
        .mockResolvedValue({ ...turnoAberto, status: CashSessionStatus.FECHADO, movements: [], summary: null, closedAt: new Date() });

      await service.closeSession("empresa-1", "user-1", "turno-1", { countedAmount: 200 });

      const dados = prisma.cashSession.updateMany.mock.calls[0][0].data;
      expect(dados.summary.sales.total).toBe(100);
      expect(dados.summary.margin.grossProfit).toBe(60);
      expect(dados.summary.cashFlow).toEqual({ supply: 0, withdrawal: 0 });
    });

    it("calcula a diferença entre contado e esperado", async () => {
      const { service, prisma } = build({
        orders: [{ paymentMethod: PaymentMethod.DINHEIRO, total: 50 }],
      });
      prisma.cashSession.findFirst
        .mockResolvedValueOnce({ ...turnoAberto })
        .mockResolvedValue({
          ...turnoAberto,
          status: CashSessionStatus.FECHADO,
          countedAmount: 145,
          expectedCash: 150,
          expectedCard: 0,
          expectedPix: 0,
          difference: -5,
          movements: [],
          closedAt: new Date(),
        });

      const relatorio = await service.closeSession("empresa-1", "user-1", "turno-1", { countedAmount: 145 });

      expect(relatorio.difference).toBe(-5);
      const dados = prisma.cashSession.updateMany.mock.calls[0][0].data;
      expect(dados.expectedCash).toBe(150);
      expect(dados.difference).toBe(-5);
    });

    it("fechar duas vezes é recusado — o segundo valor apagaria a evidência do primeiro", async () => {
      const { service } = build({ closeClaim: 0 });

      await expect(service.closeSession("empresa-1", "user-1", "turno-1", { countedAmount: 100 }))
        .rejects.toThrow(/já foi fechado/);
    });

    it("turno já fechado não fecha de novo", async () => {
      const { service } = build({
        session: { ...turnoAberto, status: CashSessionStatus.FECHADO },
      });

      await expect(service.closeSession("empresa-1", "user-1", "turno-1", { countedAmount: 100 }))
        .rejects.toThrow(/já foi fechado/);
    });

    it("valor contado negativo é recusado", async () => {
      const { service } = build();

      await expect(service.closeSession("empresa-1", "user-1", "turno-1", { countedAmount: -1 }))
        .rejects.toThrow(/negativo/);
    });

    it("o relatório de turno fechado usa a fotografia guardada, não recalcula", async () => {
      const { service, prisma } = build({
        session: {
          ...turnoAberto,
          status: CashSessionStatus.FECHADO,
          countedAmount: 999,
          difference: 0,
          movements: [],
          closedAt: new Date(),
          summary: {
            expected: { cash: 999, card: 111, pix: 0 },
            sales: { total: 1110, products: 1110, delivery: 0, discount: 0, orderCount: 9, averageTicket: 123.33 },
            margin: { available: false, cost: 0, grossProfit: null, grossMarginPercent: null, itemsWithoutCost: 3, itemsTotal: 9 },
            losses: { cancelled: 0, cancelledCount: 0, unpaid: 0, unpaidCount: 0 },
            cashFlow: { supply: 0, withdrawal: 0 },
          },
        },
        orders: [{ paymentMethod: PaymentMethod.DINHEIRO, total: 5000 }],
      });

      const relatorio = await service.report("empresa-1", "turno-1");

      expect(relatorio.expected.cash).toBe(999);
      expect(relatorio.sales.total).toBe(1110);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });
  });

  describe("histórico", () => {
    const resumo = (overrides: any = {}) => ({
      expected: { cash: 200, card: 100, pix: 0 },
      sales: { total: 300, products: 300, delivery: 0, discount: 0, orderCount: 10, averageTicket: 30 },
      margin: { available: true, cost: 120, grossProfit: 180, grossMarginPercent: 60, itemsWithoutCost: 0, itemsTotal: 10 },
      losses: { cancelled: 20, cancelledCount: 1, unpaid: 0, unpaidCount: 0 },
      cashFlow: { supply: 0, withdrawal: 50 },
      ...overrides,
    });

    function comTurnos(turnos: any[]) {
      const { service, prisma } = build();
      prisma.cashSession.findMany.mockResolvedValue(turnos);
      return { service, prisma };
    }

    it("soma o período a partir das fotografias, sem recalcular", async () => {
      const { service, prisma } = comTurnos([
        { id: "t1", status: CashSessionStatus.FECHADO, cashRegister: { id: "c1", name: "Balcão" }, openedAt: new Date(), closedAt: new Date(), openingAmount: 100, countedAmount: 300, difference: -5, notes: null, summary: resumo(), movements: [] },
        { id: "t2", status: CashSessionStatus.FECHADO, cashRegister: { id: "c1", name: "Balcão" }, openedAt: new Date(), closedAt: new Date(), openingAmount: 100, countedAmount: 300, difference: 2, notes: null, summary: resumo(), movements: [] },
      ]);

      const historico = await service.listSessions("empresa-1");

      expect(historico.totals.sessions).toBe(2);
      expect(historico.totals.revenue).toBe(600);
      expect(historico.totals.orderCount).toBe(20);
      expect(historico.totals.grossProfit).toBe(360);
      expect(historico.totals.cancelled).toBe(40);
      // Quebra acumulada: −5 + 2.
      expect(historico.totals.difference).toBe(-3);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("um turno sem custo completo deixa o lucro do período indisponível", async () => {
      const { service } = comTurnos([
        { id: "t1", status: CashSessionStatus.FECHADO, cashRegister: { id: "c1", name: "Balcão" }, openedAt: new Date(), closedAt: new Date(), openingAmount: 0, countedAmount: 0, difference: 0, notes: null, summary: resumo(), movements: [] },
        {
          id: "t2",
          status: CashSessionStatus.FECHADO,
          cashRegister: { id: "c1", name: "Balcão" },
          openedAt: new Date(),
          closedAt: new Date(),
          openingAmount: 0,
          countedAmount: 0,
          difference: 0,
          notes: null,
          summary: resumo({ margin: { available: false, cost: 0, grossProfit: null, grossMarginPercent: null, itemsWithoutCost: 2, itemsTotal: 5 } }),
          movements: [],
        },
      ]);

      const historico = await service.listSessions("empresa-1");

      expect(historico.totals.grossProfit).toBeNull();
    });

    it("turno antigo sem fotografia aparece na lista com resumo nulo", async () => {
      // Recalcular hoje daria número diferente do que foi conferido na época.
      const { service } = comTurnos([
        { id: "t0", status: CashSessionStatus.FECHADO, cashRegister: { id: "c1", name: "Balcão" }, openedAt: new Date(), closedAt: new Date(), openingAmount: 0, countedAmount: 0, difference: 0, notes: null, summary: null, movements: [] },
      ]);

      const historico = await service.listSessions("empresa-1");

      expect(historico.items).toHaveLength(1);
      expect(historico.items[0].summary).toBeNull();
      expect(historico.totals.revenue).toBe(0);
    });

    it("o intervalo de datas é semiaberto, para não perder o último minuto", async () => {
      const { service, prisma } = comTurnos([]);
      const de = new Date("2026-08-01T00:00:00Z");
      const ate = new Date("2026-08-03T00:00:00Z");

      await service.listSessions("empresa-1", { from: de, to: ate });

      const where = prisma.cashSession.findMany.mock.calls[0][0].where;
      expect(where.openedAt).toEqual({ gte: de, lt: ate });
    });
  });

  describe("pontos de venda", () => {
    it("não desativa caixa com turno aberto", async () => {
      const { service } = build({ openCount: 1 });

      await expect(service.updateRegister("empresa-1", "caixa-1", { isActive: false }))
        .rejects.toThrow(/Feche o turno/);
    });

    it("recusa nome duplicado", async () => {
      const { service } = build();

      await expect(service.createRegister("empresa-1", "Balcão")).rejects.toThrow(/já existe/i);
    });
  });
});
