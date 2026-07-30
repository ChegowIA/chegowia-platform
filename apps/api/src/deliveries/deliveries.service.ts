import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DeliveryStatus, OrderStatus, Role } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { OrdersService } from "../orders/orders.service";

const DELIVERY_INCLUDE = {
  order: { include: { customer: { select: { id: true, name: true } } } },
  motoboy: { select: { id: true, name: true } },
};

/** Mapeia a mudança de status da entrega para o status correspondente do pedido. */
const DELIVERY_TO_ORDER_STATUS: Partial<Record<DeliveryStatus, OrderStatus>> = {
  [DeliveryStatus.RETIRADO]: OrderStatus.SAIU_PARA_ENTREGA,
  [DeliveryStatus.ENTREGUE]: OrderStatus.ENTREGUE,
};

@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly realtime: RealtimeGateway,
    private readonly ordersService: OrdersService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  listForCompany(status?: DeliveryStatus) {
    return this.db().delivery.findMany({
      where: status ? { status } : {},
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  listForMotoboy(motoboyId: string) {
    return this.db().delivery.findMany({
      where: { motoboyId },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string) {
    const delivery = await this.db().delivery.findUnique({ where: { id }, include: DELIVERY_INCLUDE });
    if (!delivery) throw new NotFoundException("Entrega não encontrada.");
    return delivery;
  }

  async assign(orderId: string, motoboyId: string) {
    const motoboy = await this.db().user.findUnique({ where: { id: motoboyId } });
    const order = await this.ordersService.findByIdForCompany(orderId);

    if (!motoboy || motoboy.role !== Role.MOTOBOY || motoboy.companyId !== order.companyId || !motoboy.isActive) {
      throw new BadRequestException("Motoboy inválido para esta empresa.");
    }

    const delivery = await this.db().delivery.update({
      where: { orderId },
      data: { motoboyId },
      include: DELIVERY_INCLUDE,
    });
    this.realtime.emitToCompany(order.companyId, "delivery.updated", delivery);
    return delivery;
  }

  async updateStatus(id: string, dto: { status: DeliveryStatus; notes?: string }, currentUserId: string, role: Role) {
    const delivery = await this.findById(id);

    if (role === Role.MOTOBOY && delivery.motoboyId !== currentUserId) {
      throw new ForbiddenException("Você só pode atualizar entregas atribuídas a você.");
    }

    const timestamps: Record<string, Date> = {};
    if (dto.status === DeliveryStatus.RETIRADO) timestamps.pickedUpAt = new Date();
    if (dto.status === DeliveryStatus.ENTREGUE) timestamps.deliveredAt = new Date();

    const updated = await this.db().delivery.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes, ...timestamps },
      include: DELIVERY_INCLUDE,
    });

    this.realtime.emitToCompany(updated.order.companyId ?? delivery.companyId, "delivery.updated", updated);

    const mappedOrderStatus = DELIVERY_TO_ORDER_STATUS[dto.status];
    if (mappedOrderStatus) {
      await this.ordersService.updateStatus(updated.orderId, mappedOrderStatus, currentUserId, role);
    }

    return updated;
  }

  async updateMotoboyLocation(id: string, dto: { latitude: number; longitude: number }, motoboyId: string) {
    const delivery = await this.findById(id);

    if (delivery.motoboyId !== motoboyId) {
      throw new ForbiddenException("Você só pode compartilhar localização de entregas atribuídas a você.");
    }

    const updated = await this.db().delivery.update({
      where: { id },
      data: {
        motoboyLatitude: dto.latitude,
        motoboyLongitude: dto.longitude,
        motoboyLocationUpdatedAt: new Date(),
      },
      include: DELIVERY_INCLUDE,
    });

    this.realtime.emitToCompany(updated.order.companyId ?? delivery.companyId, "delivery.location_updated", updated);
    return updated;
  }
}
