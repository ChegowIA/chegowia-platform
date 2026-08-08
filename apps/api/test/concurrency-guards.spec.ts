import { DeliveryStatus, OrderStatus, Role, TableSessionStatus, TableStatus } from "@prisma/client";
import { TablesService } from "../src/tables/tables.service";
import { OrdersService } from "../src/orders/orders.service";
import { DeliveriesService } from "../src/deliveries/deliveries.service";

/**
 * Cada guarda abaixo troca um write cego por uma reivindicação condicional.
 * Os mocks simulam o comportamento atômico do banco: o `updateMany` só afeta a
 * linha se o WHERE ainda casar, e o segundo participante recebe count 0.
 */
describe("guardas de concorrência", () => {
  const realtime = { emitToCompany: jest.fn(), emitToUser: jest.fn(), emitToResellers: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  describe("abertura de comanda", () => {
    function prismaWithTable(status: TableStatus) {
      let claimed = false;
      return {
        restaurantTable: {
          findUnique: jest.fn().mockResolvedValue({ id: "mesa-1", status, companyId: "empresa-1" }),
          findFirst: jest.fn().mockResolvedValue({ id: "mesa-1", status, companyId: "empresa-1" }),
          updateMany: jest.fn().mockImplementation(({ where }: any) => {
            const disponivel = where.status.in.includes(status);
            if (claimed || !disponivel) return Promise.resolve({ count: 0 });
            claimed = true;
            return Promise.resolve({ count: 1 });
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        tableSession: { create: jest.fn().mockResolvedValue({ id: "sessao-1" }) },
        $transaction: jest.fn().mockImplementation((fn: any) => fn({
          restaurantTable: { updateMany: (args: any) => prismaRef.restaurantTable.updateMany(args), update: jest.fn() },
          tableSession: { create: (args: any) => prismaRef.tableSession.create(args) },
        })),
      };
      }
    let prismaRef: any;

    it("apenas um garçom abre a mesa; o segundo recebe conflito", async () => {
      prismaRef = prismaWithTable(TableStatus.LIVRE);
      const service = new TablesService(prismaRef as never, realtime as never);
      const dto: any = { guestCount: 2 };

      const primeiro = await service.open("mesa-1", dto, "garcom-1", "empresa-1");
      const segundo = await service.open("mesa-1", dto, "garcom-2", "empresa-1").catch((e: Error) => e);

      expect(primeiro).toEqual({ id: "sessao-1" });
      expect((segundo as Error).message).toMatch(/aberta por outra pessoa/i);
      expect(prismaRef.tableSession.create).toHaveBeenCalledTimes(1);
    });

    it("não abre comanda em mesa já ocupada", async () => {
      prismaRef = prismaWithTable(TableStatus.OCUPADA);
      const service = new TablesService(prismaRef as never, realtime as never);

      await expect(service.open("mesa-1", { guestCount: 2 } as any, "garcom-1", "empresa-1")).rejects.toThrow();
      expect(prismaRef.tableSession.create).not.toHaveBeenCalled();
    });
  });

  describe("transição de status do pedido", () => {
    function prismaWithOrder(statusAtual: OrderStatus) {
      let aplicado = false;
      const tx = {
        order: {
          updateMany: jest.fn().mockImplementation(({ where }: any) => {
            if (aplicado || where.status !== statusAtual) return Promise.resolve({ count: 0 });
            aplicado = true;
            return Promise.resolve({ count: 1 });
          }),
          findUnique: jest.fn().mockResolvedValue({ id: "pedido-1", companyId: "empresa-1", customerId: "cliente-1" }),
        },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
        delivery: { update: jest.fn().mockResolvedValue({}) },
      };
      return {
        tx,
        prisma: {
          order: { findUnique: jest.fn().mockResolvedValue({ id: "pedido-1", status: statusAtual, delivery: null, companyId: "empresa-1" }) },
          $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
        },
      };
    }

    it("um cancelamento simultâneo não sobrescreve a confirmação já aplicada", async () => {
      const { tx, prisma } = prismaWithOrder(OrderStatus.RECEBIDO);
      const service = new OrdersService(prisma as never, realtime as never, {} as never, { emitForOrder: jest.fn() } as never);

      await service.updateStatus("pedido-1", OrderStatus.CONFIRMADO, "user-1", Role.ADMIN);
      const segundo = await service
        .updateStatus("pedido-1", OrderStatus.CANCELADO, "user-2", Role.ADMIN)
        .catch((e: Error) => e);

      expect((segundo as Error).message).toMatch(/mudou enquanto/i);
      expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("atribuição de motoboy", () => {
    function build(statusEntrega: DeliveryStatus) {
      let atribuido = false;
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: "moto-1", role: Role.MOTOBOY, companyId: "empresa-1", isActive: true }) },
        delivery: {
          updateMany: jest.fn().mockImplementation(({ where }: any) => {
            if (atribuido || where.status !== statusEntrega) return Promise.resolve({ count: 0 });
            atribuido = true;
            return Promise.resolve({ count: 1 });
          }),
          findUnique: jest.fn().mockResolvedValue({ id: "entrega-1", motoboyId: "moto-1" }),
        },
      };
      const orders = { findByIdForCompany: jest.fn().mockResolvedValue({ id: "pedido-1", companyId: "empresa-1" }) };
      return { prisma, service: new DeliveriesService(prisma as never, realtime as never, orders as never) };
    }

    it("dois admins atribuindo: só o primeiro vence", async () => {
      const { prisma, service } = build(DeliveryStatus.AGUARDANDO_RETIRADA);

      await service.assign("pedido-1", "moto-1");
      const segundo = await service.assign("pedido-1", "moto-1").catch((e: Error) => e);

      expect((segundo as Error).message).toMatch(/já saiu para rota|outro motoboy/i);
      expect(prisma.delivery.updateMany).toHaveBeenCalledTimes(2);
    });

    it("não reatribui entrega que já está em rota", async () => {
      const { service } = build(DeliveryStatus.EM_ROTA);

      await expect(service.assign("pedido-1", "moto-1")).rejects.toThrow(/já saiu para rota|outro motoboy/i);
    });
  });
});
