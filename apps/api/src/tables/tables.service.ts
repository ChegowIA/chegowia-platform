import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DiningOrderStatus, Role, TableSessionStatus, TableStatus } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateDiningOrderDto } from "./dto/create-dining-order.dto";
import { CreateTableDto } from "./dto/create-table.dto";
import { OpenTableDto } from "./dto/open-table.dto";

const SESSION_INCLUDE = {
  openedBy: { select: { id: true, name: true } },
  orders: {
    include: { items: true, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
};

@Injectable()
export class TablesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly realtime: RealtimeGateway,
  ) {}

  private db() {
    return this.prisma as any;
  }

  async overview() {
    const tables = await this.db().restaurantTable.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        sessions: {
          where: { status: TableSessionStatus.ABERTA },
          take: 1,
          orderBy: { openedAt: "desc" },
          include: SESSION_INCLUDE,
        },
      },
    });

    const now = Date.now();
    return tables.map((table: any) => {
      const session = table.sessions[0] ?? null;
      const activeOrders = session?.orders.filter(
        (order: any) => ![DiningOrderStatus.SERVIDO, DiningOrderStatus.CANCELADO].includes(order.status),
      ) ?? [];
      const lastOrderAt = session?.orders[0]?.createdAt ?? null;
      const total = session?.orders
        .filter((order: any) => order.status !== DiningOrderStatus.CANCELADO)
        .reduce((sum: number, order: any) => sum + Number(order.subtotal), 0) ?? 0;

      return {
        ...table,
        sessions: undefined,
        session,
        metrics: session
          ? {
              total,
              activeOrderCount: activeOrders.length,
              occupiedMinutes: Math.floor((now - new Date(session.openedAt).getTime()) / 60000),
              minutesWithoutOrder: lastOrderAt
                ? null
                : Math.floor((now - new Date(session.openedAt).getTime()) / 60000),
              mostDelayedOrderMinutes: activeOrders.length
                ? Math.max(...activeOrders.map((order: any) => Math.floor((now - new Date(order.updatedAt).getTime()) / 60000)))
                : null,
            }
          : null,
      };
    });
  }

  async create(dto: CreateTableDto, companyId: string) {
    const duplicate = await this.db().restaurantTable.findFirst({ where: { name: dto.name.trim() } });
    if (duplicate) throw new ConflictException("Já existe uma mesa com esse nome.");
    const table = await this.db().restaurantTable.create({
      data: { companyId, name: dto.name.trim(), seats: dto.seats, area: dto.area?.trim() || null },
    });
    this.emit(companyId, "table.changed", table);
    return table;
  }

  async update(id: string, dto: Partial<CreateTableDto> & { status?: TableStatus }, companyId: string) {
    const table = await this.findTable(id);
    if (table.status === TableStatus.OCUPADA && dto.status && dto.status !== TableStatus.OCUPADA) {
      throw new BadRequestException("Feche a comanda antes de alterar o estado da mesa.");
    }
    const updated = await this.db().restaurantTable.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.seats !== undefined ? { seats: dto.seats } : {}),
        ...(dto.area !== undefined ? { area: dto.area?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    this.emit(companyId, "table.changed", updated);
    return updated;
  }

  async open(id: string, dto: OpenTableDto, userId: string, companyId: string) {
    const table = await this.findTable(id);
    if (table.status !== TableStatus.LIVRE && table.status !== TableStatus.RESERVADA) {
      throw new BadRequestException("Essa mesa não está disponível.");
    }
    const session = await this.db().$transaction(async (tx: any) => {
      /**
       * A mesa é reivindicada por condição, não sobrescrita. Sem isto, dois
       * garçons abrindo a mesma mesa ao mesmo tempo criavam duas sessões
       * ABERTA: os itens caíam em comandas diferentes (`addOrder` resolve a
       * sessão com `findFirst`), o fechamento pegava uma só e a outra ficava
       * órfã — nunca cobrada.
       */
      const claimed = await tx.restaurantTable.updateMany({
        where: { id, status: { in: [TableStatus.LIVRE, TableStatus.RESERVADA] } },
        data: { status: TableStatus.OCUPADA },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Essa mesa acabou de ser aberta por outra pessoa.");
      }
      return tx.tableSession.create({
        data: {
          companyId,
          tableId: id,
          openedByUserId: userId,
          guestCount: dto.guestCount,
          customerName: dto.customerName?.trim() || null,
          customerPhone: dto.customerPhone?.trim() || null,
          notes: dto.notes?.trim() || null,
        },
        include: SESSION_INCLUDE,
      });
    });
    this.emit(companyId, "table.opened", { tableId: id, session });
    return session;
  }

  async addOrder(tableId: string, dto: CreateDiningOrderDto, userId: string, companyId: string) {
    if (!dto.items.length) throw new BadRequestException("Adicione ao menos um item.");
    // `openedAt` decrescente para ser determinístico caso existam comandas
    // duplicadas de antes da correção de concorrência em `open`.
    const session = await this.db().tableSession.findFirst({
      where: { tableId, status: TableSessionStatus.ABERTA },
      orderBy: { openedAt: "desc" },
    });
    if (!session) throw new BadRequestException("Abra a mesa antes de lançar pedidos.");

    const productIds = Array.from(new Set(dto.items.map((item) => item.productId)));
    const products = await this.db().product.findMany({ where: { id: { in: productIds }, isActive: true } });
    const byId = new Map(products.map((product: any) => [product.id, product]));
    let subtotal = 0;
    const items = dto.items.map((item) => {
      const product = byId.get(item.productId) as any;
      if (!product) throw new BadRequestException("Um dos produtos está indisponível.");
      const totalPrice = Number(product.price) * item.quantity;
      subtotal += totalPrice;
      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        totalPrice,
        notes: item.notes?.trim() || null,
      };
    });

    const order = await this.db().$transaction(async (tx: any) => {
      // A comanda pode ter sido fechada entre a leitura acima e este ponto —
      // o item entraria numa conta já encerrada e nunca seria cobrado.
      const stillOpen = await tx.tableSession.count({
        where: { id: session.id, status: TableSessionStatus.ABERTA },
      });
      if (stillOpen !== 1) {
        throw new ConflictException("Essa comanda foi fechada. Abra a mesa novamente para lançar o pedido.");
      }
      return tx.diningOrder.create({
        data: {
          companyId,
          tableSessionId: session.id,
          createdByUserId: userId,
          subtotal,
          notes: dto.notes?.trim() || null,
          items: { create: items },
        },
        include: { items: true, createdBy: { select: { id: true, name: true } } },
      });
    });
    this.emit(companyId, "table.order_created", { tableId, order });
    return order;
  }

  async updateOrderStatus(orderId: string, next: DiningOrderStatus, companyId: string, actorRole: Role) {
    const order = await this.db().diningOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Pedido de mesa não encontrado.");
    // O garçom participa apenas do último passo do fluxo. Ele não consegue
    // confirmar/preparar/cancelar pedidos da cozinha, mesmo forçando a API.
    if (actorRole === Role.GARCOM && next !== DiningOrderStatus.SERVIDO) {
      throw new ForbiddenException("O garçom pode apenas marcar um pedido pronto como servido.");
    }
    this.assertTransition(order.status, next);
    const updated = await this.db().diningOrder.update({
      where: { id: orderId },
      data: { status: next, ...(next === DiningOrderStatus.SERVIDO ? { servedAt: new Date() } : {}) },
      include: { items: true, createdBy: { select: { id: true, name: true } } },
    });
    this.emit(companyId, "table.order_status_changed", { tableSessionId: order.tableSessionId, order: updated });
    return updated;
  }

  async close(tableId: string, userId: string, companyId: string) {
    const session = await this.db().tableSession.findFirst({
      where: { tableId, status: TableSessionStatus.ABERTA },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new BadRequestException("Essa mesa não possui comanda aberta.");
    const pending = session.orders.filter(
      (order: any) => ![DiningOrderStatus.SERVIDO, DiningOrderStatus.CANCELADO].includes(order.status),
    );
    if (pending.length) throw new BadRequestException("Finalize ou cancele os pedidos ativos antes de fechar a mesa.");

    const result = await this.db().$transaction(async (tx: any) => {
      // Reivindica a comanda: dois fechamentos simultâneos não sobrescrevem
      // `closedAt`/`closedByUserId` um do outro.
      const claimed = await tx.tableSession.updateMany({
        where: { id: session.id, status: TableSessionStatus.ABERTA },
        data: { status: TableSessionStatus.FECHADA, closedAt: new Date(), closedByUserId: userId },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Essa comanda já foi fechada.");
      }

      const closed = await tx.tableSession.findUnique({ where: { id: session.id }, include: SESSION_INCLUDE });
      // Reconfere pendências DENTRO da transação: um pedido lançado entre a
      // verificação inicial e este ponto derruba o fechamento inteiro, em vez
      // de ficar numa comanda fechada e nunca ser cobrado.
      const stillPending = closed.orders.filter(
        (order: any) => ![DiningOrderStatus.SERVIDO, DiningOrderStatus.CANCELADO].includes(order.status),
      );
      if (stillPending.length) {
        throw new BadRequestException("Finalize ou cancele os pedidos ativos antes de fechar a mesa.");
      }

      await tx.restaurantTable.update({ where: { id: tableId }, data: { status: TableStatus.LIVRE } });
      return closed;
    });
    this.emit(companyId, "table.closed", { tableId, sessionId: session.id });
    return result;
  }

  private async findTable(id: string) {
    const table = await this.db().restaurantTable.findUnique({ where: { id } });
    if (!table) throw new NotFoundException("Mesa não encontrada.");
    return table;
  }

  private assertTransition(current: DiningOrderStatus, next: DiningOrderStatus) {
    if (next === DiningOrderStatus.CANCELADO && current !== DiningOrderStatus.SERVIDO) return;
    const flow: DiningOrderStatus[] = [
      DiningOrderStatus.RECEBIDO,
      DiningOrderStatus.EM_PREPARO,
      DiningOrderStatus.PRONTO,
      DiningOrderStatus.SERVIDO,
    ];
    if (flow.indexOf(next) !== flow.indexOf(current) + 1) {
      throw new BadRequestException(`Transição inválida: ${current} → ${next}.`);
    }
  }

  private emit(companyId: string, event: string, payload: unknown) {
    this.realtime.emitToCompany(companyId, event, payload);
  }
}
