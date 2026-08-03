import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DeliveryStatus, OrderStatus, PaymentStatus, Role } from "@prisma/client";
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

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly realtime: RealtimeGateway,
    private readonly geography: GeographyService,
    private readonly nfce: NfceService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  // -------------------------------------------------------------------------
  // Cliente final
  // -------------------------------------------------------------------------

  async createForCustomer(customerId: string, dto: CreateOrderDto) {
    const company = await this.db().company.findFirst({
      where: { slug: dto.companySlug, isActive: true },
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
      where: { slug: dto.companySlug, isActive: true },
    });
    if (!company) throw new NotFoundException("Loja não encontrada.");
    const address = await this.db().address.findFirst({ where: { id: dto.addressId, userId: customerId } });
    if (!address) throw new NotFoundException("Endereço não encontrado.");
    return this.calculateDeliveryQuote(company, address);
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
    this.realtime.emitToUser(updated.customerId, "order.status_changed", updated);
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
