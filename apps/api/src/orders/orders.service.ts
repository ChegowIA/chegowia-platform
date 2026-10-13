import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DeliveryStatus, MessagingChannelStatus, MessagingChannelType, OrderSource, OrderStatus, PaymentMethod, PaymentStatus, Role, WhatsAppOrderDraftStatus } from "@prisma/client";
import { ORDER_STATUS_FLOW } from "@chegowia/shared";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { businessDayRange, dateKeyInTimeZone, formatDateKey } from "../common/utils/business-date";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";
import { GeographicPoint, GeographyService } from "../common/geography/geography.service";
import { PostalCodeLocationService } from "../common/geography/postal-code-location.service";
import { isStoreOpen } from "../common/utils/store-hours";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NfceService } from "../fiscal/nfce/nfce.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { DeliveryQuoteDto } from "./dto/delivery-quote.dto";
import { LOJA_INDISPONIVEL_POR_ASSINATURA, assinaturaDentroDaCarencia } from "../common/public-visibility/subscription-grace";
import { LegacyTestDataService } from "../common/legacy-test-data/legacy-test-data.service";
import { normalizarTelefoneBrasileiro } from "../messaging/outreach-contacts";

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
  estimatedByPostalCode?: boolean;
  whatsappNotificationsAvailable?: boolean;
}

type ResolvedDeliveryPoint = GeographicPoint & { estimatedByPostalCode?: boolean };

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
  optionSelections?: Array<{ groupId: string; optionIds: string[] }> | null;
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
    optionSelections?: Array<{
      groupId: string;
      groupName: string;
      pricingRule: "SUM" | "HIGHEST" | "AVERAGE";
      priceDelta: number;
      options: Array<{ id: string; name: string; priceDelta: number }>;
    }>;
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
      optionSelections: (item.optionSelections ?? []).map((group) => ({
        groupId: group.groupId,
        pricingRule: group.pricingRule,
        priceDelta: group.priceDelta,
        optionIds: group.options.map((option) => option.id).sort(),
      })).sort((a, b) => a.groupId.localeCompare(b.groupId)),
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
    private readonly postalCodeLocations?: PostalCodeLocationService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  // -------------------------------------------------------------------------
  // Cliente final
  // -------------------------------------------------------------------------

  async createForCustomer(customerId: string, dto: CreateOrderDto) {
    const visibility = this.legacyTestData
      ? await this.legacyTestData.publicCompanyVisibilityWhereForUserId(customerId)
      : { isTestOnly: false };
    const company = await this.db().company.findFirst({
      where: {
        slug: dto.companySlug,
        isActive: true,
        ...visibility,
      },
      include: {
        settings: true,
        subscription: { select: { currentPeriodEnd: true, trialEndsAt: true } },
      },
    });
    if (!company) throw new NotFoundException("Loja não encontrada.");
    // Esconder do catálogo não impede o pedido: quem tem o link direto ou o
    // carrinho aberto continuaria comprando de uma loja que parou de pagar.
    if (!assinaturaDentroDaCarencia(company.subscription)) {
      throw new NotFoundException(LOJA_INDISPONIVEL_POR_ASSINATURA);
    }

    const address = await this.db().address.findFirst({ where: { id: dto.addressId, userId: customerId } });
    if (!address) throw new NotFoundException("Endereço não encontrado.");
    this.assertConfirmedSiteLocations(company, address);
    this.assertCompanyCanReceiveOrder(company, dto.paymentMethod);
    const deliveryQuote = await this.calculateDeliveryQuote(company, address);
    const wantsWhatsApp = dto.whatsappNotificationsAccepted === true;
    const notificationPhone = wantsWhatsApp ? normalizarTelefoneBrasileiro(dto.whatsappPhone ?? "") : null;
    if (wantsWhatsApp && (!notificationPhone || notificationPhone.length !== 13)) {
      throw new BadRequestException("Informe um celular brasileiro válido para receber os avisos pelo WhatsApp.");
    }
    if (wantsWhatsApp && !(await this.orderUpdateTemplateAvailable(company.id))) {
      throw new BadRequestException("Os avisos pelo WhatsApp não estão disponíveis para esta loja no momento. Desmarque a opção para continuar.");
    }

    return tenantContext.runAsCompany(company.id, async () => {
      // O checkout do site usa a mesma resolução confiável do WhatsApp: o
      // navegador envia só IDs; preço, regras mínimas/máximas e a fotografia
      // das escolhas são sempre definidos novamente no servidor.
      const itemsData = await this.resolveTrustedOrderItems(dto.items);
      const subtotal = this.roundCurrency(itemsData.reduce((sum, item) => sum + item.totalPrice, 0));

      const deliveryFee = deliveryQuote.deliveryFee;
      const total = this.roundCurrency(subtotal + deliveryFee);

      const order = await this.db().$transaction(async (tx: any) => {
        const created = await tx.order.create({
          data: {
          customerId,
          customerPhone: notificationPhone,
          whatsappNotificationConsentAt: notificationPhone ? new Date() : null,
          addressId: address.id,
          deliveryStreet: address.street,
          deliveryNumber: address.number,
          deliveryComplement: address.complement,
          deliveryNeighborhood: address.neighborhood,
          deliveryCity: address.city,
          deliveryState: address.state,
          deliveryReference: address.reference,
          deliveryLatitude: address.latitude,
          deliveryLongitude: address.longitude,
          subtotal,
          deliveryFee,
          deliveryDistanceKm: deliveryQuote.distanceKm,
          deliveryRouteDurationMinutes: deliveryQuote.durationMinutes,
          total,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes,
          items: { create: itemsData.map((item) => this.persistedOrderItem(item)) },
          statusHistory: { create: { status: OrderStatus.RECEBIDO, changedByUserId: customerId } },
          delivery: { create: { companyId: company.id } },
          payment: { create: { companyId: company.id, method: dto.paymentMethod, amount: total } },
          },
          include: ORDER_INCLUDE,
        });
        await tx.customerProfile.upsert({
          where: { userId_companyId: { userId: customerId, companyId: company.id } },
          create: { userId: customerId, companyId: company.id, totalOrders: 1, lastOrderAt: new Date() },
          update: { totalOrders: { increment: 1 }, lastOrderAt: new Date() },
        });
        if (notificationPhone) {
          await tx.orderWhatsAppNotification.create({
            data: { companyId: company.id, orderId: created.id, orderStatus: OrderStatus.RECEBIDO, phone: notificationPhone },
          });
        }
        return created;
      });

      this.realtime.emitToCompany(company.id, "order.created", order);
      return order;
    });
  }

  async quoteForCustomer(customerId: string, dto: DeliveryQuoteDto): Promise<DeliveryQuote> {
    const visibility = this.legacyTestData
      ? await this.legacyTestData.publicCompanyVisibilityWhereForUserId(customerId)
      : { isTestOnly: false };
    const company = await this.db().company.findFirst({
      where: {
        slug: dto.companySlug,
        isActive: true,
        ...visibility,
      },
      include: { subscription: { select: { currentPeriodEnd: true, trialEndsAt: true } } },
    });
    if (!company) throw new NotFoundException("Loja não encontrada.");
    // A cotação vem antes do pedido: recusar aqui evita o cliente montar o
    // carrinho inteiro para ser barrado no fim.
    if (!assinaturaDentroDaCarencia(company.subscription)) {
      throw new NotFoundException(LOJA_INDISPONIVEL_POR_ASSINATURA);
    }
    const address = await this.db().address.findFirst({ where: { id: dto.addressId, userId: customerId } });
    if (!address) throw new NotFoundException("Endereço não encontrado.");
    this.assertConfirmedSiteLocations(company, address);
    return {
      ...await this.calculateDeliveryQuote(company, address),
      whatsappNotificationsAvailable: await this.orderUpdateTemplateAvailable(company.id),
    };
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
      whatsappNotificationsAccepted?: boolean;
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
              whatsappNotificationConsentAt: input.whatsappNotificationsAccepted ? new Date() : null,
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
              deliveryLatitude: checkout.address.latitude,
              deliveryLongitude: checkout.address.longitude,
              subtotal: checkout.subtotal,
              deliveryFee: checkout.deliveryFee,
              deliveryDistanceKm: checkout.distanceKm,
              deliveryRouteDurationMinutes: checkout.durationMinutes,
              total: checkout.total,
              paymentMethod: checkout.paymentMethod,
              notes: input.notes?.trim() || null,
              items: {
                create: checkout.items.map((item) => this.persistedOrderItem(item)),
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
        optionSelections: Array.isArray(item.optionSelections)
          ? item.optionSelections.map((group: any) => ({
              groupId: group.groupId,
              optionIds: Array.isArray(group.options) ? group.options.map((option: any) => option.id) : [],
            }))
          : undefined,
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
      if (order.customerPhone && (order.source === OrderSource.WHATSAPP || order.whatsappNotificationConsentAt)) {
        await tx.orderWhatsAppNotification.create({
          data: { companyId: order.companyId, orderId: id, orderStatus: nextStatus, phone: order.customerPhone },
        });
      }
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

  async orderUpdateTemplateAvailable(companyId: string): Promise<boolean> {
    const channel = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    const config = channel?.config && typeof channel.config === "object" ? channel.config : {};
    return Boolean(
      process.env.GUPSHUP_ENABLED === "true"
      && channel?.status === MessagingChannelStatus.ATIVO
      && channel.gupshupAppName
      && (process.env.GUPSHUP_MODE !== "PARTNER" || channel.gupshupAppId)
      && (process.env.GUPSHUP_MODE === "PARTNER" || config.number)
      && (process.env.GUPSHUP_MODE === "PARTNER" ? config.orderUpdateTemplateName : config.orderUpdateTemplateId),
    );
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
    this.assertOperationalPostalCodes(company, address);
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
      ...(origin.estimatedByPostalCode || destination.estimatedByPostalCode
        ? { estimatedByPostalCode: true }
        : {}),
    };
  }

  private async getActiveCompanyForWhatsApp(companyId: string) {
    const company = await this.db().company.findFirst({
      where: { id: companyId, isActive: true },
      include: {
        settings: true,
        subscription: { select: { currentPeriodEnd: true, trialEndsAt: true } },
      },
    });
    if (!company) throw new NotFoundException("Loja não encontrada ou indisponível.");
    // O WhatsApp da loja é o terceiro caminho de venda, e sem esta checagem
    // seria o que sobraria funcionando para quem parou de pagar.
    if (!assinaturaDentroDaCarencia(company.subscription)) {
      throw new NotFoundException(LOJA_INDISPONIVEL_POR_ASSINATURA);
    }
    return company;
  }

  private async calculateDeliveryQuoteWithCoordinates(company: any, address: WhatsAppDeliveryAddress) {
    this.assertOperationalPostalCodes(company, address);
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
      ...(origin.estimatedByPostalCode || destination.estimatedByPostalCode
        ? { estimatedByPostalCode: true }
        : {}),
      latitude: destination.latitude,
      longitude: destination.longitude,
    };
  }

  private async resolveTransientAddressCoordinates(address: WhatsAppDeliveryAddress): Promise<ResolvedDeliveryPoint> {
    const current = this.readCoordinates(address);
    if (current) return current;
    const addressLine = [address.street, address.number]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", ");
    try {
      return await this.geography.geocode({
        addressLine,
        streetName: address.street,
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
        zipCode: address.zipCode,
      });
    } catch (error) {
      return this.resolvePostalFallback(address.zipCode, address.city, address.state, "cliente", error);
    }
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
        optionGroups: {
          where: { isActive: true },
          orderBy: { position: "asc" },
          include: {
            options: { where: { isActive: true }, orderBy: { position: "asc" } },
          },
        },
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
      const { optionSelections, totalPriceDelta: optionGroupsTotal } = this.resolveProductOptionSelections(
        product,
        input.optionSelections,
      );
      const unitPrice = this.roundCurrency(
        Number(product.price) + Number(variation?.priceDelta ?? 0) + optionGroupsTotal,
      );
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
        optionSelections,
        notes,
        totalPrice,
      };
    });
  }

  /**
   * Confere as escolhas contra a configuração atual do produto e devolve uma
   * fotografia pronta para o pedido. Nenhum preço vindo do navegador/WhatsApp
   * é usado: a regra de grupo decide se soma, cobra o maior ou calcula média.
   */
  private resolveProductOptionSelections(product: any, rawSelections: TrustedOrderItemInput["optionSelections"]) {
    if (rawSelections !== undefined && rawSelections !== null && !Array.isArray(rawSelections)) {
      throw new BadRequestException(`As escolhas de ${product.name} estão inválidas.`);
    }
    const entries = rawSelections ?? [];
    if (entries.length > 20) throw new BadRequestException("Um item pode ter no máximo 20 grupos de escolhas.");

    const submittedByGroup = new Map<string, string[]>();
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") throw new BadRequestException(`As escolhas de ${product.name} estão inválidas.`);
      const groupId = typeof raw.groupId === "string" ? raw.groupId.trim() : "";
      if (!groupId || groupId.length > 191 || submittedByGroup.has(groupId)) {
        throw new BadRequestException(`Há um grupo de escolhas inválido em ${product.name}.`);
      }
      if (!Array.isArray(raw.optionIds) || raw.optionIds.length === 0 || raw.optionIds.length > 30) {
        throw new BadRequestException(`Escolha ao menos uma opção válida em ${product.name}.`);
      }
      const optionIds = raw.optionIds.map((id) => typeof id === "string" ? id.trim() : "");
      if (optionIds.some((id) => !id || id.length > 191) || new Set(optionIds).size !== optionIds.length) {
        throw new BadRequestException(`Há opções repetidas ou inválidas em ${product.name}.`);
      }
      submittedByGroup.set(groupId, optionIds);
    }

    const groups = Array.isArray(product.optionGroups) ? product.optionGroups : [];
    const knownGroupIds = new Set(groups.map((group: any) => group.id));
    for (const groupId of submittedByGroup.keys()) {
      if (!knownGroupIds.has(groupId)) {
        throw new BadRequestException(`Um grupo de escolhas de ${product.name} não está mais disponível.`);
      }
    }

    const optionSelections: Array<{
      groupId: string;
      groupName: string;
      pricingRule: "SUM" | "HIGHEST" | "AVERAGE";
      priceDelta: number;
      options: Array<{ id: string; name: string; priceDelta: number }>;
    }> = [];
    let totalPriceDelta = 0;

    for (const group of groups) {
      const optionIds = submittedByGroup.get(group.id) ?? [];
      const min = Number(group.minSelections);
      const max = Number(group.maxSelections);
      if (optionIds.length < min || optionIds.length > max) {
        throw new BadRequestException(this.choiceCountMessage(product.name, group.name, min, max));
      }
      if (!optionIds.length) continue;

      const optionsById = new Map((group.options ?? []).map((option: any) => [option.id, option]));
      const options = optionIds.map((optionId) => {
        const option = optionsById.get(optionId) as any;
        if (!option) {
          throw new BadRequestException(`Uma opção escolhida em "${group.name}" não está disponível para ${product.name}.`);
        }
        return { id: option.id, name: option.name, priceDelta: Number(option.priceDelta) };
      });
      const deltas = options.map((option) => option.priceDelta);
      const pricingRule = String(group.pricingRule) as "SUM" | "HIGHEST" | "AVERAGE";
      const priceDelta = this.roundCurrency(
        pricingRule === "HIGHEST"
          ? Math.max(...deltas)
          : pricingRule === "AVERAGE"
            ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length
            : deltas.reduce((sum, delta) => sum + delta, 0),
      );
      totalPriceDelta += priceDelta;
      optionSelections.push({ groupId: group.id, groupName: group.name, pricingRule, priceDelta, options });
    }

    return { optionSelections, totalPriceDelta: this.roundCurrency(totalPriceDelta) };
  }

  private choiceCountMessage(productName: string, groupName: string, min: number, max: number) {
    if (min === max) {
      return `Escolha exatamente ${min} ${min === 1 ? "opção" : "opções"} em "${groupName}" para ${productName}.`;
    }
    if (min > 0) {
      return `Escolha entre ${min} e ${max} opções em "${groupName}" para ${productName}.`;
    }
    return `Escolha no máximo ${max} ${max === 1 ? "opção" : "opções"} em "${groupName}" para ${productName}.`;
  }

  private persistedOrderItem(item: any) {
    const { variationId: _variationId, addonIds: _addonIds, ...data } = item;
    return data;
  }

  private findExistingWhatsAppOrder(companyId: string, draftId: string) {
    return this.db().order.findFirst({
      where: { companyId, whatsappOrderDraftId: draftId },
      include: ORDER_INCLUDE,
    });
  }

  private async resolveCompanyCoordinates(company: any): Promise<ResolvedDeliveryPoint> {
    const current = this.readCoordinates(company);
    if (current) return current;
    if (!company.addressLine?.trim() || !company.city?.trim() || !company.state?.trim() || !hasPostalCode(company.zipCode)) {
      throw new BadRequestException("A loja precisa cadastrar um endereço completo para calcular a rota de entrega.");
    }
    let coordinates: GeographicPoint;
    try {
      coordinates = await this.geography.geocode({
        addressLine: company.addressLine,
        streetName: company.addressLine.includes(",") ? company.addressLine.split(",")[0]?.trim() : null,
        city: company.city,
        state: company.state,
        zipCode: company.zipCode,
      });
    } catch (error) {
      return this.resolvePostalFallback(company.zipCode, company.city, company.state, "loja", error);
    }
    await this.db().company.update({
      where: { id: company.id },
      data: coordinates,
    });
    return coordinates;
  }

  private async resolveAddressCoordinates(address: any): Promise<ResolvedDeliveryPoint> {
    const current = this.readCoordinates(address);
    if (current) return current;
    const addressLine = [address.street, address.number]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", ");
    let coordinates: GeographicPoint;
    try {
      coordinates = await this.geography.geocode({
        addressLine,
        streetName: address.street,
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
        zipCode: address.zipCode,
      });
    } catch (error) {
      return this.resolvePostalFallback(address.zipCode, address.city, address.state, "cliente", error);
    }
    await this.db().address.update({
      where: { id: address.id },
      data: coordinates,
    });
    return coordinates;
  }

  private async resolvePostalFallback(
    zipCode: string | null | undefined,
    city: string,
    state: string,
    target: "loja" | "cliente",
    originalError: unknown,
  ): Promise<ResolvedDeliveryPoint> {
    if (!(originalError instanceof BadRequestException) && !(originalError instanceof ServiceUnavailableException)) {
      throw originalError;
    }
    try {
      const coordinates = this.postalCodeLocations
        ? await this.postalCodeLocations.resolve(zipCode, { city, state })
        : await this.geography.geocodePostalCode(String(zipCode ?? ""), { city, state });
      this.logger.warn(`Localização aproximada por CEP usada para ${target}; endereço exato não encontrado.`);
      return { ...coordinates, estimatedByPostalCode: true };
    } catch (error) {
      this.logger.warn(`Falha ao localizar ${target} por CEP após falha no endereço exato.`);
      if (error instanceof BadRequestException) {
        throw new BadRequestException(
          `Não foi possível localizar o CEP ${target === "loja" ? "da loja" : "do endereço de entrega"}: ${error.message}`,
        );
      }
      throw new ServiceUnavailableException(
        `Não foi possível calcular a entrega agora porque a localização ${target === "loja" ? "da loja" : "do cliente"} está indisponível. Tente novamente.`,
      );
    }
  }

  private assertOperationalPostalCodes(company: { zipCode?: unknown }, address: { zipCode?: unknown }) {
    if (!hasPostalCode(company.zipCode)) {
      throw new BadRequestException("A loja precisa informar o CEP operacional antes de aceitar entregas.");
    }
    if (!hasPostalCode(address.zipCode)) {
      throw new BadRequestException("Informe um CEP válido de 8 dígitos no seu endereço para calcular a entrega.");
    }
  }

  private assertConfirmedSiteLocations(company: any, address: any) {
    // Uma loja antiga pode ter coordenada já localizada pelo endereço completo.
    // Preservamos a operação nesse caso; se o endereço da loja mudar, a edição
    // limpa esse ponto e passa a exigir confirmação manual antes da próxima venda.
    if (!this.readCoordinates(company)) {
      throw new BadRequestException("A loja precisa confirmar no mapa o ponto de saída da entrega nas Configurações antes de aceitar pedidos pelo site.");
    }
    if (!address.locationConfirmedAt || !this.readCoordinates(address)) {
      throw new BadRequestException("Confirme no mapa o ponto exato do seu endereço de entrega antes de calcular o frete.");
    }
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

function hasPostalCode(value: unknown) {
  return /^\d{8}$/.test(String(value ?? "").replace(/\D/g, ""));
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}
