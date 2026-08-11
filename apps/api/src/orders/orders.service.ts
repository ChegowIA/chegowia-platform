import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DeliveryStatus, OrderSource, OrderStatus, PaymentMethod, PaymentStatus, Role, WhatsAppOrderDraftStatus } from "@prisma/client";
import { ORDER_STATUS_FLOW } from "@chegowia/shared";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { businessDayRange, dateKeyInTimeZone, formatDateKey } from "../common/utils/business-date";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";
import { GeographicPoint, GeographyService } from "../common/geography/geography.service";
import { isStoreOpen } from "../common/utils/store-hours";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NfceService } from "../fiscal/nfce/nfce.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { DeliveryQuoteDto } from "./dto/delivery-quote.dto";
import { LegacyTestDataService } from "../common/legacy-test-data/legacy-test-data.service";

const ORDER_INCLUDE = {
  items: true,
  statusHistory: { orderBy: { createdAt: "asc" as const } },
  delivery: { include: { motoboy: { select: { id: true, name: true } } } },
  payment: true,
  customer: { select: { id: true, name: true, email: true } },
  address: true,
};

const ORDER_TO_DELIVERY_STATUS: Partial<Record<OrderStatus, DeliveryStatus>> = {
  [OrderStatus.PRONTO]: DeliveryStatus.AGUARDANDO_RETIRADA,
  [OrderStatus.SAIU_PARA_ENTREGA]: DeliveryStatus.EM_ROTA,
  [OrderStatus.ENTREGUE]: DeliveryStatus.ENTREGUE,
};

export interface DeliveryQuote {
  distanceKm: number;
  durationMinutes: number;
  deliveryFee: number;
}

/**
 * Entrada sem preço para um pedido montado fora do checkout autenticado.
 * IDs e quantidades podem vir do WhatsApp, mas preço, adicionais e variações
 * são sempre resolvidos novamente no banco da empresa antes de gravar.
 */
export interface TrustedOrderItemInput {
  productId: string;
  quantity: number;
  variationId?: string | null;
  addonIds?: string[] | null;
  notes?: string | null;
}

export interface WhatsAppDeliveryAddress {
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode?: string | null;
  reference?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface PreparedWhatsAppCheckout {
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    unitCost: number | null;
    variationId: string | null;
    variationName: string | null;
    variationPriceDelta: number;
    addonIds: string[];
    addons: Array<{ name: string; price: number }>;
    notes: string | null;
    totalPrice: number;
  }>;
  address: WhatsAppDeliveryAddress & { latitude: number; longitude: number };
  paymentMethod: PaymentMethod;
  subtotal: number;
  deliveryFee: number;
  distanceKm: number;
  durationMinutes: number;
  total: number;
}

/** Hash estável da proposta que o cliente viu. Nunca inclui custo interno. */
export function whatsappCheckoutFingerprint(checkout: PreparedWhatsAppCheckout) {
  const payload = {
    items: checkout.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      variationId: item.variationId,
      variationPriceDelta: item.variationPriceDelta,
      addonIds: [...item.addonIds].sort(),
      addons: item.addons.map((addon) => ({ name: addon.name, price: addon.price })),
      notes: item.notes,
      totalPrice: item.totalPrice,
    })),
    address: {
      street: checkout.address.street,
      number: checkout.address.number,
      complement: checkout.address.complement ?? null,
      neighborhood: checkout.address.neighborhood,
      city: checkout.address.city,
      state: checkout.address.state,
      zipCode: checkout.address.zipCode ?? null,
      reference: checkout.address.reference ?? null,
    },
    paymentMethod: checkout.paymentMethod,
    subtotal: checkout.subtotal,
    deliveryFee: checkout.deliveryFee,
    distanceKm: checkout.distanceKm,
    durationMinutes: checkout.durationMinutes,
    total: checkout.total,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly realtime: RealtimeGateway,
    private readonly geography: GeographyService,
    private readonly nfce: NfceService,
    private readonly legacyTestData?: LegacyTestDataService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  // -------------------------------------------------------------------------
  // Cliente final
  // -------------------------------------------------------------------------

  async createForCustomer(customerId: string, dto: CreateOrderDto) {
    const company = await this.db().company.findFirst({
      where: {
        slug: dto.companySlug,
        isActive: true,
        ...(this.legacyTestData?.publicCompanyVisibilityWhereForUserId(customerId) ?? { isTestOnly: false }),
      },
      include: { settings: true },
    });
    if (!company) throw new NotFoundException("Loja não encontrada.");

    const address = await this.db().address.findFirst({ where: { id: dto.addressId, userId: customerId } });
    if (!address) throw new NotFoundException("Endereço não encontrado.");
    this.assertCompanyCanReceiveOrder(company, dto.paymentMethod);
    const deliveryQuote = await this.calculateDeliveryQuote(company, address);

    return tenantContext.runAsCompany(company.id, async () => {
      const productIds = dto.items.map((i) => i.productId);
      const products = await this.db().product.findMany({
        where: { id: { in: productIds }, isActive: true },
        include: { variations: true, addons: true },
      });
      const productMap = new Map(products.map((p: any) => [p.id, p]));

      let subtotal = 0;
      const itemsData = dto.items.map((item) => {
        const product = productMap.get(item.productId) as any;
        if (!product) throw new BadRequestException(`Produto ${item.productId} indisponível.`);

        const unitPrice = Number(product.price);
        let variationName: string | undefined;
        let variationPriceDelta = 0;
        if (item.variationId) {
          const variation = product.variations.find((v: any) => v.id === item.variationId);
          if (!variation) throw new BadRequestException("Variação inválida.");
          variationName = variation.name;
          variationPriceDelta = Number(variation.priceDelta);
        }

        const chosenAddons = (item.addonIds ?? []).map((addonId) => {
          const addon = product.addons.find((a: any) => a.id === addonId);
          if (!addon) throw new BadRequestException("Adicional inválido.");
          return { name: addon.name, price: Number(addon.price) };
        });
        const addonsTotal = chosenAddons.reduce((sum, a) => sum + a.price, 0);

        const lineUnitPrice = unitPrice + variationPriceDelta;
        const totalPrice = (lineUnitPrice + addonsTotal) * item.quantity;
        subtotal += totalPrice;

        return {
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: lineUnitPrice,
          // Fotografado agora: o custo do produto muda, e recalcular a margem
          // pelo custo de hoje reescreveria o resultado de um mês fechado.
          unitCost: product.costPrice === null || product.costPrice === undefined
            ? null
            : Number(product.costPrice),
          variationName,
          variationPriceDelta,
          addons: chosenAddons,
          notes: item.notes,
          totalPrice,
        };
      });

      const deliveryFee = deliveryQuote.deliveryFee;
      const total = subtotal + deliveryFee;

      const order = await this.db().order.create({
        data: {
          customerId,
          addressId: address.id,
          deliveryStreet: address.street,
          deliveryNumber: address.number,
          deliveryComplement: address.complement,
          deliveryNeighborhood: address.neighborhood,
          deliveryCity: address.city,
          deliveryState: address.state,
          deliveryReference: address.reference,
          subtotal,
          deliveryFee,
          deliveryDistanceKm: deliveryQuote.distanceKm,
          deliveryRouteDurationMinutes: deliveryQuote.durationMinutes,
          total,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes,
          items: { create: itemsData },
          statusHistory: { create: { status: OrderStatus.RECEBIDO, changedByUserId: customerId } },
          delivery: { create: { companyId: company.id } },
          payment: { create: { companyId: company.id, method: dto.paymentMethod, amount: total } },
        },
        include: ORDER_INCLUDE,
      });

      await this.db().customerProfile.upsert({
        where: { userId_companyId: { userId: customerId, companyId: company.id } },
        create: { userId: customerId, companyId: company.id, totalOrders: 1, lastOrderAt: new Date() },
        update: { totalOrders: { increment: 1 }, lastOrderAt: new Date() },
      });

      this.realtime.emitToCompany(company.id, "order.created", order);
      return order;
    });
  }

  async quoteForCustomer(customerId: string, dto: DeliveryQuoteDto): Promise<DeliveryQuote> {
    const company = await this.db().company.findFirst({
      where: {
        slug: dto.companySlug,
        isActive: true,
        ...(this.legacyTestData?.publicCompanyVisibilityWhereForUserId(customerId) ?? { isTestOnly: false }),
      },
    });
    if (!company) throw new NotFoundException("Loja não encontrada.");
    const address = await this.db().address.findFirst({ where: { id: dto.addressId, userId: customerId } });
    if (!address) throw new NotFoundException("Endereço não encontrado.");
    return this.calculateDeliveryQuote(company, address);
  }

  // -------------------------------------------------------------------------
  // Checkout pelo WhatsApp — sem conta do cliente, mas com a mesma regra de
  // catálogo, horário, rota e preço usada no checkout autenticado.
  // -------------------------------------------------------------------------

  /**
   * Calcula uma rota real para o endereço informado no WhatsApp. Não grava um
   * Address de usuário: o cliente não possui login e as coordenadas voltam ao
   * rascunho da própria conversa, isolado por empresa.
   */
  async quoteWhatsAppDelivery(companyId: string, address: WhatsAppDeliveryAddress) {
    return tenantContext.runAsCompany(companyId, async () => {
      const company = await this.getActiveCompanyForWhatsApp(companyId);
      return this.calculateDeliveryQuoteWithCoordinates(company, address);
    });
  }

  /**
   * Prepara a fotografia completa que será mostrada ao cliente antes de ele
   * confirmar. Nada deste método confia em valores enviados pela IA.
   */
  async prepareWhatsAppCheckout(
    companyId: string,
    input: { items: TrustedOrderItemInput[]; address: WhatsAppDeliveryAddress; paymentMethod: PaymentMethod },
  ): Promise<PreparedWhatsAppCheckout> {
    return tenantContext.runAsCompany(companyId, async () => {
      const company = await this.getActiveCompanyForWhatsApp(companyId);
      this.assertCompanyCanReceiveOrder(company, input.paymentMethod);

      const [items, delivery] = await Promise.all([
        this.resolveTrustedOrderItems(input.items),
        this.calculateDeliveryQuoteWithCoordinates(company, input.address),
      ]);
      const subtotal = this.roundCurrency(items.reduce((sum, item) => sum + item.totalPrice, 0));
      const total = this.roundCurrency(subtotal + delivery.deliveryFee);

      return {
        items,
        address: { ...input.address, latitude: delivery.latitude, longitude: delivery.longitude },
        paymentMethod: input.paymentMethod,
        subtotal,
        deliveryFee: delivery.deliveryFee,
        distanceKm: delivery.distanceKm,
        durationMinutes: delivery.durationMinutes,
        total,
      };
    });
  }

  /**
   * Cria a venda sem criar uma conta artificial para quem falou pelo WhatsApp.
   * O índice único do rascunho é a trava final contra um webhook duplicado ou
   * duas tentativas simultâneas de confirmação gerarem pedidos duplicados.
   */
  async createWhatsAppOrder(
    companyId: string,
    input: {
      draftId: string;
      conversationId: string;
      customerName: string;
      customerPhone: string;
      items: TrustedOrderItemInput[];
      address: WhatsAppDeliveryAddress;
      paymentMethod: PaymentMethod;
      notes?: string | null;
      expectedFingerprint?: string | null;
    },
  ) {
    return tenantContext.runAsCompany(companyId, async () => {
      const existing = await this.findExistingWhatsAppOrder(companyId, input.draftId);
      if (existing) return { order: existing, created: false };

      const checkout = await this.prepareWhatsAppCheckout(companyId, input);
      if (input.expectedFingerprint && whatsappCheckoutFingerprint(checkout) !== input.expectedFingerprint) {
        throw new ConflictException("O carrinho ou o valor foi atualizado. Mostre o novo resumo e peça uma nova confirmação.");
      }
      try {
        const order = await this.db().$transaction(async (tx: any) => {
          const created = await tx.order.create({
            data: {
              companyId,
              customerId: null,
              customerName: input.customerName,
              customerPhone: input.customerPhone,
              source: OrderSource.WHATSAPP,
              whatsappConversationId: input.conversationId,
              whatsappOrderDraftId: input.draftId,
              deliveryStreet: checkout.address.street,
              deliveryNumber: checkout.address.number,
              deliveryComplement: checkout.address.complement ?? null,
              deliveryNeighborhood: checkout.address.neighborhood,
              deliveryCity: checkout.address.city,
              deliveryState: checkout.address.state,
              deliveryReference: checkout.address.reference ?? null,
              subtotal: checkout.subtotal,
              deliveryFee: checkout.deliveryFee,
              deliveryDistanceKm: checkout.distanceKm,
              deliveryRouteDurationMinutes: checkout.durationMinutes,
              total: checkout.total,
              paymentMethod: checkout.paymentMethod,
              notes: input.notes?.trim() || null,
              items: {
                create: checkout.items.map((item) => ({
                  productId: item.productId,
                  productName: item.productName,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  unitCost: item.unitCost,
                  variationName: item.variationName,
                  variationPriceDelta: item.variationPriceDelta,
                  addons: item.addons,
                  notes: item.notes,
                  totalPrice: item.totalPrice,
                })),
              },
              statusHistory: { create: { status: OrderStatus.RECEBIDO } },
              delivery: { create: { companyId } },
              payment: { create: { companyId, method: checkout.paymentMethod, amount: checkout.total } },
            },
            include: ORDER_INCLUDE,
          });
          // Fecha o carrinho no mesmo commit que cria a venda. Assim uma queda
          // entre as duas etapas não deixa uma proposta antiga aberta para ser
          // confundida com um novo pedido do mesmo número.
          await tx.whatsAppOrderDraft.updateMany({
            where: { id: input.draftId, companyId },
            data: {
              status: WhatsAppOrderDraftStatus.CONCLUIDO,
              activeKey: null,
              confirmedAt: new Date(),
              completedAt: new Date(),
              lastError: null,
            },
          });
          return created;
        });
        this.realtime.emitToCompany(companyId, "order.created", order);
        return { order, created: true };
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        const duplicate = await this.findExistingWhatsAppOrder(companyId, input.draftId);
        if (duplicate) return { order: duplicate, created: false };
        throw error;
      }
    });
  }

  async myOrders(customerId: string) {
    return this.db().order.findMany({
      where: { customerId },
      include: { ...ORDER_INCLUDE, company: { select: { id: true, name: true, slug: true, whatsapp: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async myOrderDetail(customerId: string, id: string) {
    const order = await this.db().order.findFirst({
      where: { id, customerId },
      include: { ...ORDER_INCLUDE, company: { select: { id: true, name: true, slug: true, whatsapp: true } } },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado.");
    return order;
  }

  async repeat(customerId: string, orderId: string) {
    const original = await this.myOrderDetail(customerId, orderId);
    return this.createForCustomer(customerId, {
      companySlug: original.company.slug,
      addressId: original.addressId,
      paymentMethod: original.paymentMethod,
      notes: original.notes ?? undefined,
      items: original.items.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
        notes: item.notes ?? undefined,
      })),
    });
  }

  // -------------------------------------------------------------------------
  // Painel da empresa (já tenant-scoped pelo Prisma extension)
  // -------------------------------------------------------------------------

  async listForCompany(query: PaginationQueryDto & { status?: OrderStatus }) {
    const where: any = {};
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      this.db().order.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: ORDER_INCLUDE,
      }),
      this.db().order.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async flowForCompany(query: { date?: string; search?: string }) {
    const timeZone = process.env.BUSINESS_TIMEZONE ?? "America/Sao_Paulo";
    const today = dateKeyInTimeZone(new Date(), timeZone);
    const selectedDate = query.date?.trim() || today;
    const range = businessDayRange(selectedDate, timeZone);
    const firstOrder = await this.db().order.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const firstDate = firstOrder
      ? dateKeyInTimeZone(new Date(firstOrder.createdAt), timeZone)
      : today;

    if (selectedDate < firstDate || selectedDate > today) {
      throw new BadRequestException(
        `Selecione uma data entre ${formatDateKey(firstDate)} e ${formatDateKey(today)}.`,
      );
    }

    const search = query.search?.trim();
    const where: any = {
      createdAt: { gte: range.start, lt: range.end },
    };
    if (search) {
      where.OR = [
        { id: { contains: search } },
        { customer: { is: { name: { contains: search } } } },
        { customer: { is: { email: { contains: search } } } },
        { customerName: { contains: search } },
        { customerPhone: { contains: search } },
      ];
    }

    const items = await this.db().order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: ORDER_INCLUDE,
    });

    return {
      items,
      selectedDate,
      firstDate,
      lastDate: today,
    };
  }

  async findByIdForCompany(id: string) {
    const order = await this.db().order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException("Pedido não encontrado.");
    return order;
  }

  async today() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.db().order.findMany({
      where: { createdAt: { gte: start } },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async pendingCount() {
    return this.db().order.count({
      where: { status: { notIn: [OrderStatus.ENTREGUE, OrderStatus.CANCELADO] } },
    });
  }

  /** Pedidos parados há mais de `thresholdMinutes` num status não-terminal. */
  async delayed(thresholdMinutes = 30) {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    return this.db().order.findMany({
      where: {
        status: { notIn: [OrderStatus.ENTREGUE, OrderStatus.CANCELADO] },
        updatedAt: { lt: threshold },
      },
      include: ORDER_INCLUDE,
      orderBy: { updatedAt: "asc" },
    });
  }

  /**
   * Dispara a emissão da NFC-e sem bloquear quem chamou.
   *
   * Falha aqui não desfaz a venda — o pedido está pago de qualquer forma. O
   * registro fica no log e o documento aparece em Painel > Notas fiscais com a
   * pendência explicada.
   */
  private async emitFiscalDocument(companyId: string, orderId: string) {
    try {
      const profile = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });
      if (!profile?.autoEmit) return;
      await this.nfce.emitForOrder(companyId, orderId);
    } catch (error) {
      this.logger.error(
        `Não foi possível emitir a NFC-e do pedido ${orderId}: `
        + `${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
    }
  }

  async updateStatus(id: string, nextStatus: OrderStatus, changedByUserId: string, changedByRole: Role) {
    const order = await this.findByIdForCompany(id);

    const cozinhaAllowed: OrderStatus[] = [OrderStatus.EM_PREPARO, OrderStatus.PRONTO];
    if (changedByRole === Role.COZINHA && !cozinhaAllowed.includes(nextStatus)) {
      throw new ForbiddenException("Cozinha só pode marcar como Em preparo ou Pronto.");
    }

    this.assertValidTransition(order.status, nextStatus);

    const deliveryStatus = ORDER_TO_DELIVERY_STATUS[nextStatus];
    const updated = await this.db().$transaction(async (tx: any) => {
      /**
       * A transição é aplicada por condição sobre o status lido: quem chegar
       * segundo não sobrescreve o primeiro. Sem isto, dois usuários partindo de
       * RECEBIDO — um cancelando, outro mandando EM_PREPARO — passavam ambos
       * pela validação e gravavam, então um pedido cancelado para o cliente
       * continuava sendo preparado e saía para entrega.
       */
      const applied = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: nextStatus },
      });
      if (applied.count !== 1) {
        throw new ConflictException("O status deste pedido mudou enquanto você confirmava. Recarregue e tente de novo.");
      }
      await tx.orderStatusHistory.create({ data: { orderId: id, status: nextStatus, changedByUserId } });
      if (deliveryStatus && order.delivery) {
        await tx.delivery.update({
          where: { orderId: id },
          data: {
            status: deliveryStatus,
            ...(deliveryStatus === DeliveryStatus.ENTREGUE ? { deliveredAt: new Date() } : {}),
            ...(deliveryStatus === DeliveryStatus.EM_ROTA && !order.delivery.pickedUpAt ? { pickedUpAt: new Date() } : {}),
          },
        });
      }
      return tx.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    });

    this.realtime.emitToCompany(updated.companyId, "order.status_changed", updated);
    if (updated.customerId) this.realtime.emitToUser(updated.customerId, "order.status_changed", updated);
    if (deliveryStatus && updated.delivery) {
      this.realtime.emitToCompany(updated.companyId, "delivery.updated", updated.delivery);
    }
    return updated;
  }

  async markPaymentPaid(id: string) {
    const order = await this.findByIdForCompany(id);
    await this.db().payment.update({ where: { orderId: id }, data: { status: PaymentStatus.PAGO, paidAt: new Date() } });
    const updated = await this.db().order.update({
      where: { id },
      data: { paymentStatus: PaymentStatus.PAGO },
      include: ORDER_INCLUDE,
    });
    // A nota sai depois da resposta, nunca antes: se a SEFAZ estiver lenta ou o
    // cadastro fiscal incompleto, o caixa não pode travar por causa disso. A
    // emissão tem contingência própria e o worker reprocessa o que falhar.
    void this.emitFiscalDocument(order.companyId, id);
    return updated;
  }

  private assertValidTransition(current: OrderStatus, next: OrderStatus) {
    if (current === OrderStatus.ENTREGUE || current === OrderStatus.CANCELADO) {
      throw new BadRequestException(`Pedido já está em um status final (${current}).`);
    }
    if (next === OrderStatus.CANCELADO) return;

    const currentIndex = ORDER_STATUS_FLOW.indexOf(current as any);
    const nextIndex = ORDER_STATUS_FLOW.indexOf(next as any);
    if (nextIndex !== currentIndex + 1) {
      throw new BadRequestException(`Transição de status inválida: ${current} -> ${next}.`);
    }
  }

  private assertCompanyCanReceiveOrder(company: any, paymentMethod: any) {
    const methods = Array.isArray(company.settings?.paymentMethodsEnabled)
      ? company.settings.paymentMethodsEnabled
      : [];
    if (methods.length > 0 && !methods.includes(paymentMethod)) {
      throw new BadRequestException("A forma de pagamento escolhida não é aceita por esta loja.");
    }
    if (!isStoreOpen(company.settings?.openingHours)) {
      throw new BadRequestException("A loja está fechada neste momento.");
    }
  }

  private async calculateDeliveryQuote(company: any, address: any): Promise<DeliveryQuote> {
    const [origin, destination] = await Promise.all([
      this.resolveCompanyCoordinates(company),
      this.resolveAddressCoordinates(address),
    ]);
    const route = await this.geography.calculateDrivingRoute(origin, destination);
    const deliveryRadiusKm = Number(company.deliveryRadiusKm);
    if (!Number.isFinite(deliveryRadiusKm) || deliveryRadiusKm <= 0) {
      throw new BadRequestException("A loja ainda não configurou um raio de entrega válido.");
    }
    if (route.distanceKm > deliveryRadiusKm) {
      throw new BadRequestException(
        `O endereço está a ${route.distanceKm.toFixed(2)} km pela rota e excede o raio de entrega de ${deliveryRadiusKm.toFixed(2)} km.`,
      );
    }
    const fee = this.roundCurrency(
      Number(company.deliveryFeeBase) + route.distanceKm * Number(company.deliveryFeePerKm),
    );
    return {
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      deliveryFee: fee,
    };
  }

  private async getActiveCompanyForWhatsApp(companyId: string) {
    const company = await this.db().company.findFirst({
      where: { id: companyId, isActive: true },
      include: { settings: true },
    });
    if (!company) throw new NotFoundException("Loja não encontrada ou indisponível.");
    return company;
  }

  private async calculateDeliveryQuoteWithCoordinates(company: any, address: WhatsAppDeliveryAddress) {
    const [origin, destination] = await Promise.all([
      this.resolveCompanyCoordinates(company),
      this.resolveTransientAddressCoordinates(address),
    ]);
    const route = await this.geography.calculateDrivingRoute(origin, destination);
    const deliveryRadiusKm = Number(company.deliveryRadiusKm);
    if (!Number.isFinite(deliveryRadiusKm) || deliveryRadiusKm <= 0) {
      throw new BadRequestException("A loja ainda não configurou um raio de entrega válido.");
    }
    if (route.distanceKm > deliveryRadiusKm) {
      throw new BadRequestException(
        `O endereço está a ${route.distanceKm.toFixed(2)} km pela rota e excede o raio de entrega de ${deliveryRadiusKm.toFixed(2)} km.`,
      );
    }
    return {
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      deliveryFee: this.roundCurrency(
        Number(company.deliveryFeeBase) + route.distanceKm * Number(company.deliveryFeePerKm),
      ),
      latitude: destination.latitude,
      longitude: destination.longitude,
    };
  }

  private async resolveTransientAddressCoordinates(address: WhatsAppDeliveryAddress): Promise<GeographicPoint> {
    const current = this.readCoordinates(address);
    if (current) return current;
    const addressLine = [address.street, address.number, address.complement]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", ");
    return this.geography.geocode({
      addressLine,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
    });
  }

  private async resolveTrustedOrderItems(inputItems: TrustedOrderItemInput[]) {
    if (!Array.isArray(inputItems) || inputItems.length === 0) {
      throw new BadRequestException("Adicione ao menos um item ao pedido.");
    }
    if (inputItems.length > 40) throw new BadRequestException("O pedido pode ter no máximo 40 itens diferentes.");
    const productIds = [...new Set(inputItems.map((item) => String(item.productId ?? "").trim()).filter(Boolean))];
    const products = await this.db().product.findMany({
      where: { id: { in: productIds }, isActive: true },
      include: {
        variations: { where: { isActive: true } },
        addons: { where: { isActive: true } },
      },
    });
    const productsById = new Map(products.map((product: any) => [product.id, product]));

    return inputItems.map((input) => {
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw new BadRequestException("A quantidade de cada item deve ser entre 1 e 99.");
      }
      const product = productsById.get(String(input.productId ?? "").trim()) as any;
      if (!product) throw new BadRequestException("Um item do carrinho não está mais disponível.");

      const variationId = typeof input.variationId === "string" ? input.variationId.trim() || null : null;
      const variation = variationId ? product.variations.find((item: any) => item.id === variationId) : null;
      if (variationId && !variation) throw new BadRequestException(`A variação escolhida para ${product.name} não está disponível.`);

      const addonIds = [...new Set((input.addonIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
      if (addonIds.length > 20) throw new BadRequestException("Um item pode ter no máximo 20 adicionais.");
      const addons = addonIds.map((addonId) => {
        const addon = product.addons.find((item: any) => item.id === addonId);
        if (!addon) throw new BadRequestException(`Um adicional escolhido para ${product.name} não está disponível.`);
        return { name: addon.name, price: Number(addon.price) };
      });
      const unitPrice = this.roundCurrency(Number(product.price) + Number(variation?.priceDelta ?? 0));
      const addonsTotal = addons.reduce((sum, addon) => sum + addon.price, 0);
      const totalPrice = this.roundCurrency((unitPrice + addonsTotal) * quantity);
      const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 500) || null : null;

      return {
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice,
        unitCost: product.costPrice === null || product.costPrice === undefined ? null : Number(product.costPrice),
        variationId,
        variationName: variation?.name ?? null,
        variationPriceDelta: Number(variation?.priceDelta ?? 0),
        addonIds,
        addons,
        notes,
        totalPrice,
      };
    });
  }

  private findExistingWhatsAppOrder(companyId: string, draftId: string) {
    return this.db().order.findFirst({
      where: { companyId, whatsappOrderDraftId: draftId },
      include: ORDER_INCLUDE,
    });
  }

  private async resolveCompanyCoordinates(company: any): Promise<GeographicPoint> {
    const current = this.readCoordinates(company);
    if (current) return current;
    if (!company.addressLine?.trim() || !company.city?.trim() || !company.state?.trim()) {
      throw new BadRequestException("A loja precisa cadastrar um endereço completo para calcular a rota de entrega.");
    }
    const coordinates = await this.geography.geocode({
      addressLine: company.addressLine,
      city: company.city,
      state: company.state,
    });
    await this.db().company.update({
      where: { id: company.id },
      data: coordinates,
    });
    return coordinates;
  }

  private async resolveAddressCoordinates(address: any): Promise<GeographicPoint> {
    const current = this.readCoordinates(address);
    if (current) return current;
    const addressLine = [address.street, address.number, address.complement]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", ");
    const coordinates = await this.geography.geocode({
      addressLine,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
    });
    await this.db().address.update({
      where: { id: address.id },
      data: coordinates,
    });
    return coordinates;
  }

  private readCoordinates(value: { latitude?: unknown; longitude?: unknown }): GeographicPoint | null {
    if (value.latitude === null || value.latitude === undefined || value.longitude === null || value.longitude === undefined) {
      return null;
    }
    const latitude = Number(value.latitude);
    const longitude = Number(value.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  private roundCurrency(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}
