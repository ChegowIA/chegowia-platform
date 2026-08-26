import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DiningOrderSource, DiningOrderStatus, Role, TableSessionStatus, TableStatus } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";
import { NfceService } from "../fiscal/nfce/nfce.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CloseTableDto } from "./dto/close-table.dto";
import { CreateDiningOrderDto } from "./dto/create-dining-order.dto";
import { CreateTableDto } from "./dto/create-table.dto";
import { OpenTableDto } from "./dto/open-table.dto";

const SESSION_INCLUDE = {
  openedBy: { select: { id: true, name: true } },
  attendant: { select: { id: true, name: true } },
  orders: {
    include: { items: true, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
};

const PUBLIC_MENU_INCLUDE = {
  variations: { where: { isActive: true } },
  addons: { where: { isActive: true } },
  optionGroups: {
    where: { isActive: true },
    orderBy: { position: "asc" as const },
    include: {
      options: { where: { isActive: true }, orderBy: { position: "asc" as const } },
    },
  },
};

// A resposta do QR é uma superfície pública. Mantemos somente o necessário
// para montar o cardápio e enviar a escolha; companyId, categoryId, dados
// fiscais e demais metadados internos nunca saem por ela.
const PUBLIC_MENU_SELECT = {
  id: true,
  name: true,
  description: true,
  products: {
    where: { isActive: true },
    orderBy: { name: "asc" as const },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      variations: {
        where: { isActive: true },
        select: { id: true, name: true, priceDelta: true },
      },
      addons: {
        where: { isActive: true },
        select: { id: true, name: true, price: true },
      },
      optionGroups: {
        where: { isActive: true },
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          selectionType: true,
          minSelections: true,
          maxSelections: true,
          pricingRule: true,
          position: true,
          isActive: true,
          options: {
            where: { isActive: true },
            orderBy: { position: "asc" },
            select: { id: true, name: true, priceDelta: true, position: true, isActive: true },
          },
        },
      },
    },
  },
};

@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly realtime: RealtimeGateway,
    // Opcional apenas para manter os testes unitários de mesa independentes;
    // no módulo real FiscalModule sempre fornece o emissor.
    private readonly nfce?: NfceService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  async overview() {
    const tables = await this.db().restaurantTable.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      // O token do QR é deliberadamente ausente desta visão operacional: só o
      // administrador pede o token pontualmente no endpoint protegido de QR.
      select: {
        id: true,
        name: true,
        seats: true,
        area: true,
        status: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
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
    const duplicate = await this.db().restaurantTable.findFirst({ where: { companyId, name: dto.name.trim() } });
    if (duplicate) throw new ConflictException("Já existe uma mesa com esse nome.");
    const table = await this.db().restaurantTable.create({
      data: {
        companyId,
        name: dto.name.trim(),
        seats: dto.seats,
        area: dto.area?.trim() || null,
        qrToken: this.createQrToken(),
      },
    });
    this.emit(companyId, "table.changed", table);
    return table;
  }

  async update(id: string, dto: Partial<CreateTableDto> & { status?: TableStatus }, companyId: string) {
    const table = await this.findTable(id, companyId);
    if (table.status === TableStatus.OCUPADA && dto.status && dto.status !== TableStatus.OCUPADA) {
      throw new BadRequestException("Feche a comanda antes de alterar o estado da mesa.");
    }
    const updated = await this.db().restaurantTable.updateMany({
      where: { id, companyId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.seats !== undefined ? { seats: dto.seats } : {}),
        ...(dto.area !== undefined ? { area: dto.area?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    if (updated.count !== 1) throw new NotFoundException("Mesa não encontrada.");
    const result = await this.findTable(id, companyId);
    this.emit(companyId, "table.changed", result);
    return result;
  }

  async open(id: string, dto: OpenTableDto, userId: string, companyId: string) {
    const table = await this.findTable(id, companyId);
    if (table.status !== TableStatus.LIVRE && table.status !== TableStatus.RESERVADA) {
      throw new BadRequestException("Essa mesa não está disponível.");
    }
    this.assertGuestCountFitsTable(dto.guestCount, table.seats);
    const session = await this.db().$transaction(async (tx: any) => {
      /**
       * A mesa é reivindicada por condição, não sobrescrita. Sem isto, dois
       * garçons abrindo a mesma mesa ao mesmo tempo criavam duas sessões
       * ABERTA: os itens caíam em comandas diferentes (`addOrder` resolve a
       * sessão com `findFirst`), o fechamento pegava uma só e a outra ficava
       * órfã — nunca cobrada.
       */
      const claimed = await tx.restaurantTable.updateMany({
        where: { id, companyId, status: { in: [TableStatus.LIVRE, TableStatus.RESERVADA] } },
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
          attendantUserId: userId,
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
    const order = await this.createDiningOrder(tableId, dto, companyId, {
      createdByUserId: userId,
      source: DiningOrderSource.EQUIPE,
    });
    this.emit(companyId, "table.order_created", { tableId, order });
    return order;
  }

  /**
   * Uma pessoa da equipe assume uma comanda aberta pelo QR antes de encerrá-la.
   * Isso deixa explícito no painel quem está responsável pela mesa e impede que
   * outro acesso (ou o próprio cliente) encerre o atendimento por engano.
   */
  async assume(tableId: string, userId: string, companyId: string) {
    const session = await this.db().tableSession.findFirst({
      where: { tableId, companyId, status: TableSessionStatus.ABERTA },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new BadRequestException("Essa mesa não possui comanda aberta.");
    if (session.attendantUserId === userId) return session;
    if (session.attendantUserId) {
      throw new ForbiddenException("Esta mesa já está em atendimento por outra pessoa da equipe.");
    }

    const claimed = await this.db().tableSession.updateMany({
      where: { id: session.id, companyId, status: TableSessionStatus.ABERTA, attendantUserId: null },
      data: { attendantUserId: userId },
    });
    if (claimed.count !== 1) {
      throw new ConflictException("Esta mesa acabou de ser assumida por outra pessoa.");
    }
    const updated = await this.db().tableSession.findFirst({ where: { id: session.id, companyId }, include: SESSION_INCLUDE });
    this.emit(companyId, "table.attendant_assigned", { tableId, session: updated });
    return updated;
  }

  async rotateQrToken(id: string, companyId: string) {
    await this.findTable(id, companyId);
    // O espaço de 192 bits torna uma colisão impraticável; a rotação invalida
    // imediatamente qualquer impressão antiga sem revelar o id da mesa.
    const qrToken = this.createQrToken();
    const updated = await this.db().restaurantTable.updateMany({
      where: { id, companyId },
      data: { qrToken },
    });
    if (updated.count !== 1) throw new NotFoundException("Mesa não encontrada.");
    const table = { id, qrToken };
    this.emit(companyId, "table.changed", table);
    return table;
  }

  async getQrToken(id: string, companyId: string) {
    const table = await this.findTable(id, companyId);
    return { id: table.id, name: table.name, qrToken: table.qrToken };
  }

  /** Cardápio mínimo e isolado para o QR: não entrega slug, ids internos ou navegação do sistema. */
  async getPublicMenu(token: string) {
    const table = await this.findPublicTableByToken(token);
    return tenantContext.runAsCompany(table.companyId, async () => {
      const [categories, session] = await Promise.all([
        this.db().category.findMany({
          where: { isActive: true },
          orderBy: { position: "asc" },
          select: PUBLIC_MENU_SELECT,
        }),
        this.db().tableSession.findFirst({
          where: { tableId: table.id, companyId: table.companyId, status: TableSessionStatus.ABERTA },
          orderBy: { openedAt: "desc" },
          select: { guestCount: true, openedAt: true, attendantUserId: true },
        }),
      ]);

      return {
        company: { name: table.company.name, logoUrl: table.company.logoUrl },
        table: { name: table.name, seats: table.seats, area: table.area },
        // Não expomos nome/telefone de quem já está na comanda. Quem aponta a
        // câmera só precisa saber que a mesa está pronta para receber pedido.
        session: session
          ? {
              isOpen: true,
              guestCount: session.guestCount,
              isBeingAttended: Boolean(session.attendantUserId),
              openedAt: session.openedAt,
            }
          : null,
        categories,
      };
    });
  }

  /** Abre a mesma comanda usada pelo salão, sem dar à pessoa nenhuma sessão interna. */
  async openFromQr(token: string, dto: OpenTableDto) {
    const table = await this.findPublicTableByToken(token);
    const result = await tenantContext.runAsCompany(table.companyId, async () => {
      const current = await this.db().tableSession.findFirst({
        where: { tableId: table.id, companyId: table.companyId, status: TableSessionStatus.ABERTA },
        orderBy: { openedAt: "desc" },
        select: { guestCount: true, openedAt: true, attendantUserId: true },
      });
      if (current) return this.publicSession(current);

      if (![TableStatus.LIVRE, TableStatus.RESERVADA].includes(table.status)) {
        throw new BadRequestException("Essa mesa não está disponível para abrir pelo QR.");
      }
      this.assertGuestCountFitsTable(dto.guestCount, table.seats);

      const session = await this.db().$transaction(async (tx: any) => {
        const claimed = await tx.restaurantTable.updateMany({
          where: { id: table.id, companyId: table.companyId, status: { in: [TableStatus.LIVRE, TableStatus.RESERVADA] } },
          data: { status: TableStatus.OCUPADA },
        });
        if (claimed.count !== 1) {
          throw new ConflictException("Essa mesa acabou de ser aberta. Atualize para continuar.");
        }
        return tx.tableSession.create({
          data: {
            companyId: table.companyId,
            tableId: table.id,
            openedByUserId: null,
            attendantUserId: null,
            openedFromQr: true,
            guestCount: dto.guestCount,
            customerName: dto.customerName?.trim() || null,
            customerPhone: dto.customerPhone?.trim() || null,
            notes: dto.notes?.trim() || null,
          },
          select: { guestCount: true, openedAt: true, attendantUserId: true },
        });
      });
      return this.publicSession(session);
    });
    this.emit(table.companyId, "table.opened", { tableId: table.id, source: "QR_MESA" });
    return result;
  }

  /** Pedido público sempre é vinculado à sessão aberta da mesa apontada pelo QR. */
  async addOrderFromQr(token: string, dto: CreateDiningOrderDto) {
    const table = await this.findPublicTableByToken(token);
    const order = await tenantContext.runAsCompany(table.companyId, () =>
      this.createDiningOrder(table.id, dto, table.companyId, {
        createdByUserId: null,
        source: DiningOrderSource.QR_MESA,
      }),
    );
    this.emit(table.companyId, "table.order_created", { tableId: table.id, order });
    return {
      id: order.id,
      status: order.status,
      subtotal: Number(order.subtotal),
      itemCount: order.items.reduce((sum: number, item: any) => sum + item.quantity, 0),
    };
  }

  private async createDiningOrder(
    tableId: string,
    dto: CreateDiningOrderDto,
    companyId: string,
    actor: { createdByUserId: string | null; source: DiningOrderSource },
  ) {
    if (!dto.items.length) throw new BadRequestException("Adicione ao menos um item.");
    // `openedAt` decrescente para ser determinístico caso existam comandas
    // duplicadas de antes da correção de concorrência em `open`.
    const session = await this.db().tableSession.findFirst({
      where: { tableId, companyId, status: TableSessionStatus.ABERTA },
      orderBy: { openedAt: "desc" },
    });
    if (!session) throw new BadRequestException("Abra a mesa antes de lançar pedidos.");

    const { subtotal, items } = await this.prepareDiningItems(dto, companyId);

    const order = await this.db().$transaction(async (tx: any) => {
      // Esta escrita condicional também funciona como lock da comanda. Se o
      // fechamento vencer a corrida, count será 0; se o pedido vencer, o
      // fechamento espera a rodada ser criada e a enxerga antes de concluir.
      // Assim nunca existe pedido criado depois de uma mesa fechada.
      const lockedSession = await tx.tableSession.updateMany({
        where: { id: session.id, companyId, status: TableSessionStatus.ABERTA },
        data: { updatedAt: new Date() },
      });
      if (lockedSession.count !== 1) {
        throw new ConflictException("Essa comanda foi fechada. Abra a mesa novamente para lançar o pedido.");
      }
      return tx.diningOrder.create({
        data: {
          companyId,
          tableSessionId: session.id,
          createdByUserId: actor.createdByUserId,
          source: actor.source,
          subtotal,
          notes: dto.notes?.trim() || null,
          items: { create: items },
        },
        include: { items: true, createdBy: { select: { id: true, name: true } } },
      });
    });
    return order;
  }

  async updateOrderStatus(orderId: string, next: DiningOrderStatus, companyId: string, actorRole: Role) {
    const order = await this.db().diningOrder.findFirst({ where: { id: orderId, companyId } });
    if (!order) throw new NotFoundException("Pedido de mesa não encontrado.");
    // O garçom participa apenas do último passo do fluxo. Ele não consegue
    // confirmar/preparar/cancelar pedidos da cozinha, mesmo forçando a API.
    if (actorRole === Role.GARCOM && next !== DiningOrderStatus.SERVIDO) {
      throw new ForbiddenException("O garçom pode apenas marcar um pedido pronto como servido.");
    }
    this.assertTransition(order.status, next);
    const claimed = await this.db().diningOrder.updateMany({
      where: { id: orderId, companyId, status: order.status },
      data: { status: next, ...(next === DiningOrderStatus.SERVIDO ? { servedAt: new Date() } : {}) },
    });
    if (claimed.count !== 1) throw new ConflictException("O pedido mudou enquanto você o atualizava.");
    const updated = await this.db().diningOrder.findFirst({
      where: { id: orderId, companyId },
      include: { items: true, createdBy: { select: { id: true, name: true } } },
    });
    this.emit(companyId, "table.order_status_changed", { tableSessionId: order.tableSessionId, order: updated });
    return updated;
  }

  async close(tableId: string, userId: string, companyId: string, dto: CloseTableDto) {
    const session = await this.db().tableSession.findFirst({
      where: { tableId, companyId, status: TableSessionStatus.ABERTA },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new BadRequestException("Essa mesa não possui comanda aberta.");
    if (session.attendantUserId !== userId) {
      throw new ForbiddenException("Somente a pessoa que assumiu este atendimento pode fechar a mesa.");
    }
    const pending = session.orders.filter(
      (order: any) => ![DiningOrderStatus.SERVIDO, DiningOrderStatus.CANCELADO].includes(order.status),
    );
    if (pending.length) throw new BadRequestException("Finalize ou cancele os pedidos ativos antes de fechar a mesa.");

    const closedAt = new Date();
    const result = await this.db().$transaction(async (tx: any) => {
      // Reivindica a comanda: dois fechamentos simultâneos não sobrescrevem
      // `closedAt`/`closedByUserId` um do outro.
      const claimed = await tx.tableSession.updateMany({
        where: { id: session.id, companyId, status: TableSessionStatus.ABERTA },
        data: {
          status: TableSessionStatus.FECHADA,
          closedAt,
          closedByUserId: userId,
          paymentMethod: dto.paymentMethod,
          customerDocument: dto.customerDocument ?? session.customerDocument ?? null,
          paidAt: closedAt,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Essa comanda já foi fechada.");
      }

      const closed = await tx.tableSession.findFirst({ where: { id: session.id, companyId }, include: SESSION_INCLUDE });
      // Reconfere pendências DENTRO da transação: um pedido lançado entre a
      // verificação inicial e este ponto derruba o fechamento inteiro, em vez
      // de ficar numa comanda fechada e nunca ser cobrado.
      const stillPending = closed.orders.filter(
        (order: any) => ![DiningOrderStatus.SERVIDO, DiningOrderStatus.CANCELADO].includes(order.status),
      );
      if (stillPending.length) {
        throw new BadRequestException("Finalize ou cancele os pedidos ativos antes de fechar a mesa.");
      }

      const released = await tx.restaurantTable.updateMany({
        where: { id: tableId, companyId, status: TableStatus.OCUPADA },
        data: { status: TableStatus.LIVRE },
      });
      if (released.count !== 1) throw new ConflictException("Não foi possível liberar esta mesa.");
      return closed;
    });
    const profile = await this.db().companyFiscalProfile.findUnique({
      where: { companyId },
      select: { autoEmit: true },
    });
    const automaticFiscalEmission = Boolean(profile?.autoEmit);
    if (automaticFiscalEmission) {
      // A venda e a liberação da mesa não esperam a SEFAZ. O emissor registra
      // contingência/rejeição e a tela Fiscal mantém a ação manual disponível.
      void this.autoEmitTableNfce(companyId, session.id);
    }
    this.emit(companyId, "table.closed", { tableId, sessionId: session.id, automaticFiscalEmission });
    return { ...result, fiscal: { automaticFiscalEmission } };
  }

  private async autoEmitTableNfce(companyId: string, tableSessionId: string) {
    if (!this.nfce) return;
    try {
      await this.nfce.emitForTableSession(companyId, tableSessionId);
    } catch (error) {
      this.logger.error(
        `Não foi possível emitir a NFC-e da comanda ${tableSessionId}: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
    }
  }

  private async findTable(id: string, companyId: string) {
    const table = await this.db().restaurantTable.findFirst({ where: { id, companyId } });
    if (!table) throw new NotFoundException("Mesa não encontrada.");
    return table;
  }

  private async findPublicTableByToken(token: string) {
    const qrToken = token.trim();
    if (qrToken.length < 16 || qrToken.length > 191) throw new NotFoundException("QR da mesa não encontrado.");
    const table = await tenantContext.run({ companyId: null, bypass: true }, () =>
      this.db().restaurantTable.findUnique({
        where: { qrToken },
        include: { company: { select: { id: true, name: true, logoUrl: true, isActive: true } } },
      }),
    );
    if (!table || !table.company.isActive || table.status === TableStatus.INATIVA) {
      throw new NotFoundException("Este QR de mesa não está disponível.");
    }
    return table;
  }

  private async prepareDiningItems(dto: CreateDiningOrderDto, companyId: string) {
    const productIds = Array.from(new Set(dto.items.map((item) => item.productId)));
    const products = await this.db().product.findMany({
      where: { id: { in: productIds }, companyId, isActive: true },
      include: PUBLIC_MENU_INCLUDE,
    });
    const byId = new Map(products.map((product: any) => [product.id, product]));
    let subtotal = 0;
    const items = dto.items.map((item) => {
      const product = byId.get(item.productId) as any;
      if (!product) throw new BadRequestException("Um dos produtos está indisponível.");

      const variation = item.variationId
        ? product.variations.find((candidate: any) => candidate.id === item.variationId)
        : null;
      if (item.variationId && !variation) throw new BadRequestException("Uma das variações escolhidas não está disponível.");

      const selectedAddonIds = Array.from(new Set(item.addonIds ?? []));
      const addons = selectedAddonIds.map((addonId) => {
        const addon = product.addons.find((candidate: any) => candidate.id === addonId);
        if (!addon) throw new BadRequestException("Um dos adicionais escolhidos não está disponível.");
        return addon;
      });
      const configuredChoices = this.resolveDiningOptionSelections(product, item.optionSelections);
      const unitPrice = Number(product.price)
        + Number(variation?.priceDelta ?? 0)
        + addons.reduce((sum: number, addon: any) => sum + Number(addon.price), 0)
        + configuredChoices.totalPriceDelta;
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;
      const choices = [
        variation ? `Opção: ${variation.name}` : null,
        addons.length ? `Adicionais: ${addons.map((addon: any) => addon.name).join(", ")}` : null,
        configuredChoices.label,
        item.notes?.trim() || null,
      ].filter(Boolean).join(" · ");

      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        // `DiningOrderItem.notes` ainda é VARCHAR(191) nas instalações atuais.
        // Truncamos de forma explícita para não deixar o banco recusar uma rodada.
        notes: choices ? choices.slice(0, 191) : null,
      };
    });
    return { subtotal, items };
  }

  /** Mantém o QR de mesa com as mesmas regras de montagem do pedido delivery. */
  private resolveDiningOptionSelections(product: any, rawSelections: Array<{ groupId: string; optionIds: string[] }> | undefined) {
    const selections = rawSelections ?? [];
    const submitted = new Map<string, string[]>();
    for (const selection of selections) {
      const groupId = typeof selection?.groupId === "string" ? selection.groupId.trim() : "";
      const optionIds = Array.isArray(selection?.optionIds)
        ? selection.optionIds.map((id) => typeof id === "string" ? id.trim() : "")
        : [];
      if (!groupId || !optionIds.length || submitted.has(groupId) || optionIds.some((id) => !id) || new Set(optionIds).size !== optionIds.length) {
        throw new BadRequestException(`As escolhas de ${product.name} estão inválidas.`);
      }
      submitted.set(groupId, optionIds);
    }

    const groups = product.optionGroups ?? [];
    const knownGroups = new Set(groups.map((group: any) => group.id));
    if ([...submitted.keys()].some((groupId) => !knownGroups.has(groupId))) {
      throw new BadRequestException(`Uma escolha de ${product.name} não está mais disponível.`);
    }

    let totalPriceDelta = 0;
    const labels: string[] = [];
    for (const group of groups) {
      const optionIds = submitted.get(group.id) ?? [];
      const min = Number(group.minSelections);
      const max = Number(group.maxSelections);
      if (optionIds.length < min || optionIds.length > max) {
        throw new BadRequestException(this.diningChoiceCountMessage(product.name, group.name, min, max));
      }
      if (!optionIds.length) continue;
      const byId = new Map((group.options ?? []).map((option: any) => [option.id, option]));
      const options = optionIds.map((id) => {
        const option = byId.get(id) as any;
        if (!option) throw new BadRequestException(`Uma opção de "${group.name}" não está mais disponível.`);
        return option;
      });
      const deltas = options.map((option: any) => Number(option.priceDelta));
      const priceDelta = group.pricingRule === "HIGHEST"
        ? Math.max(...deltas)
        : group.pricingRule === "AVERAGE"
          ? deltas.reduce((sum: number, delta: number) => sum + delta, 0) / deltas.length
          : deltas.reduce((sum: number, delta: number) => sum + delta, 0);
      totalPriceDelta += priceDelta;
      labels.push(`${group.name}: ${options.map((option: any) => option.name).join(", ")}`);
    }
    return { totalPriceDelta: this.roundCurrency(totalPriceDelta), label: labels.length ? labels.join(" · ") : null };
  }

  private diningChoiceCountMessage(productName: string, groupName: string, min: number, max: number) {
    if (min === max) return `Escolha exatamente ${min} ${min === 1 ? "opção" : "opções"} em "${groupName}" para ${productName}.`;
    if (min > 0) return `Escolha entre ${min} e ${max} opções em "${groupName}" para ${productName}.`;
    return `Escolha no máximo ${max} ${max === 1 ? "opção" : "opções"} em "${groupName}" para ${productName}.`;
  }

  private publicSession(session: { guestCount: number; openedAt: Date; attendantUserId: string | null }) {
    return {
      isOpen: true,
      guestCount: session.guestCount,
      isBeingAttended: Boolean(session.attendantUserId),
      openedAt: session.openedAt,
    };
  }

  private createQrToken() {
    return randomBytes(24).toString("base64url");
  }

  private roundCurrency(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private assertGuestCountFitsTable(guestCount: number, seats: number) {
    if (guestCount > seats) {
      throw new BadRequestException(`Esta mesa comporta até ${seats} ${seats === 1 ? "pessoa" : "pessoas"}.`);
    }
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
