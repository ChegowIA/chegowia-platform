import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, Role } from "@prisma/client";
import { ORDER_STATUS_FLOW } from "@chegowia/shared";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateOrderDto } from "./dto/create-order.dto";

const ORDER_INCLUDE = {
  items: true,
  statusHistory: { orderBy: { createdAt: "asc" as const } },
  delivery: { include: { motoboy: { select: { id: true, name: true } } } },
  payment: true,
  customer: { select: { id: true, name: true, email: true } },
  address: true,
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly realtime: RealtimeGateway,
  ) {}

  private db() {
    return this.prisma as any;
  }

  // -------------------------------------------------------------------------
  // Cliente final
  // -------------------------------------------------------------------------

  async createForCustomer(customerId: string, dto: CreateOrderDto) {
    const company = await this.db().company.findFirst({ where: { slug: dto.companySlug, isActive: true } });
    if (!company) throw new NotFoundException("Loja não encontrada.");

    const address = await this.db().address.findFirst({ where: { id: dto.addressId, userId: customerId } });
    if (!address) throw new NotFoundException("Endereço não encontrado.");

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

        let unitPrice = Number(product.price);
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
          variationName,
          variationPriceDelta,
          addons: chosenAddons,
          notes: item.notes,
          totalPrice,
        };
      });

      const deliveryArea = await this.db().deliveryArea.findFirst({
        where: { neighborhood: { contains: address.neighborhood }, isActive: true },
      });
      const deliveryFee = deliveryArea ? Number(deliveryArea.deliveryFee ?? company.deliveryFeeBase) : Number(company.deliveryFeeBase);
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

  async updateStatus(id: string, nextStatus: OrderStatus, changedByUserId: string, changedByRole: Role) {
    const order = await this.findByIdForCompany(id);

    const cozinhaAllowed: OrderStatus[] = [OrderStatus.EM_PREPARO, OrderStatus.PRONTO];
    if (changedByRole === Role.COZINHA && !cozinhaAllowed.includes(nextStatus)) {
      throw new ForbiddenException("Cozinha só pode marcar como Em preparo ou Pronto.");
    }

    this.assertValidTransition(order.status, nextStatus);

    const updated = await this.db().order.update({
      where: { id },
      data: {
        status: nextStatus,
        statusHistory: { create: { status: nextStatus, changedByUserId } },
      },
      include: ORDER_INCLUDE,
    });

    this.realtime.emitToCompany(updated.companyId, "order.status_changed", updated);
    return updated;
  }

  async markPaymentPaid(id: string) {
    await this.findByIdForCompany(id);
    await this.db().payment.update({ where: { orderId: id }, data: { status: PaymentStatus.PAGO, paidAt: new Date() } });
    return this.db().order.update({ where: { id }, data: { paymentStatus: PaymentStatus.PAGO }, include: ORDER_INCLUDE });
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
}
