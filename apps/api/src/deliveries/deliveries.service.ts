import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DeliveryProblemReason, DeliveryStatus, OrderStatus, Role } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { OrdersService } from "../orders/orders.service";

const DELIVERY_INCLUDE = {
  order: { include: { customer: { select: { id: true, name: true } } } },
  motoboy: { select: { id: true, name: true } },
  incidents: { orderBy: { reportedAt: "desc" } },
};

/** Mapeia a mudança de status da entrega para o status correspondente do pedido. */
const DELIVERY_TO_ORDER_STATUS: Partial<Record<DeliveryStatus, OrderStatus>> = {
  [DeliveryStatus.EM_ROTA]: OrderStatus.SAIU_PARA_ENTREGA,
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

    /**
     * Atribuição condicional: só entrega ainda aguardando retirada aceita
     * motoboy. Antes era um `update` cego por chave, o que permitia (a) dois
     * admins atribuindo simultaneamente com last-write-wins e (b) reatribuir
     * uma entrega já EM_ROTA ou ENTREGUE — o motoboy anterior simplesmente
     * perdia a corrida da lista, sem aviso.
     */
    const assigned = await this.db().delivery.updateMany({
      where: { orderId, status: DeliveryStatus.AGUARDANDO_RETIRADA },
      data: { motoboyId },
    });
    if (assigned.count !== 1) {
      throw new ConflictException("Esta entrega já saiu para rota ou foi atribuída a outro motoboy.");
    }
    const delivery = await this.db().delivery.findUnique({
      where: { orderId },
      include: DELIVERY_INCLUDE,
    });
    this.realtime.emitToCompany(order.companyId, "delivery.updated", delivery);
    return delivery;
  }

  async updateStatus(
    id: string,
    dto: {
      status: DeliveryStatus;
      notes?: string;
      problemReason?: DeliveryProblemReason;
      problemDescription?: string;
    },
    currentUserId: string,
    role: Role,
  ) {
    const delivery = await this.findById(id);

    if (role === Role.MOTOBOY && delivery.motoboyId !== currentUserId) {
      throw new ForbiddenException("Você só pode atualizar entregas atribuídas a você.");
    }
    this.assertValidTransition(delivery, dto.status);

    if (dto.status === DeliveryStatus.PROBLEMA) {
      if (!dto.problemReason) {
        throw new BadRequestException("Selecione o motivo do problema.");
      }
      if (
        dto.problemReason === DeliveryProblemReason.OUTRO
        && !dto.problemDescription?.trim()
      ) {
        throw new BadRequestException("Descreva o que aconteceu ao selecionar outro motivo.");
      }
      const reportedAt = new Date();
      const updated = await this.db().$transaction(async (tx: any) => {
        await tx.deliveryIncident.create({
          data: {
            deliveryId: id,
            previousStatus: delivery.status,
            reason: dto.problemReason,
            description: dto.problemDescription?.trim() || null,
            reportedByUserId: currentUserId,
            reportedAt,
          },
        });
        return tx.delivery.update({
          where: { id },
          data: {
            status: DeliveryStatus.PROBLEMA,
            statusBeforeProblem: delivery.status,
            problemReason: dto.problemReason,
            problemDescription: dto.problemDescription?.trim() || null,
            problemReportedAt: reportedAt,
            problemResolvedAt: null,
            notes: dto.notes,
          },
          include: DELIVERY_INCLUDE,
        });
      });
      this.realtime.emitToCompany(updated.order.companyId ?? delivery.companyId, "delivery.updated", updated);
      if (updated.order.customerId) this.realtime.emitToUser(updated.order.customerId, "delivery.problem_reported", updated);
      return updated;
    }

    const timestamps: Record<string, Date> = {};
    if (dto.status === DeliveryStatus.RETIRADO) timestamps.pickedUpAt = new Date();
    if (dto.status === DeliveryStatus.ENTREGUE) timestamps.deliveredAt = new Date();

    const mappedOrderStatus = DELIVERY_TO_ORDER_STATUS[dto.status];
    if (mappedOrderStatus && delivery.order.status !== mappedOrderStatus) {
      await this.ordersService.updateStatus(delivery.orderId, mappedOrderStatus, currentUserId, role);
    }

    const resolvedAt = delivery.status === DeliveryStatus.PROBLEMA ? new Date() : null;
    const updated = await this.db().$transaction(async (tx: any) => {
      if (resolvedAt) {
        const incident = await tx.deliveryIncident.findFirst({
          where: { deliveryId: id, resolvedAt: null },
          orderBy: { reportedAt: "desc" },
          select: { id: true },
        });
        if (incident) {
          await tx.deliveryIncident.update({
            where: { id: incident.id },
            data: { resolvedAt, resolvedByUserId: currentUserId },
          });
        }
      }
      return tx.delivery.update({
        where: { id },
        data: {
          status: dto.status,
          notes: dto.notes,
          ...timestamps,
          ...(resolvedAt ? { problemResolvedAt: resolvedAt } : {}),
        },
        include: DELIVERY_INCLUDE,
      });
    });
    this.realtime.emitToCompany(updated.order.companyId ?? delivery.companyId, "delivery.updated", updated);
    if (updated.order.customerId) this.realtime.emitToUser(updated.order.customerId, "delivery.updated", updated);
    return updated;
  }

  private assertValidTransition(delivery: any, next: DeliveryStatus) {
    const current = delivery.status as DeliveryStatus;
    if (current === next) throw new BadRequestException("A entrega já está neste status.");
    if (current === DeliveryStatus.ENTREGUE) {
      throw new BadRequestException("Uma entrega concluída não pode ter o status alterado.");
    }
    if (current === DeliveryStatus.PROBLEMA) {
      const resumeStatus = delivery.statusBeforeProblem as DeliveryStatus | null;
      if (!resumeStatus || next !== resumeStatus) {
        throw new BadRequestException(
          "Resolva o incidente retornando a entrega à etapa em que ela estava.",
        );
      }
      return;
    }
    if (next === DeliveryStatus.PROBLEMA) return;

    const expected: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
      [DeliveryStatus.AGUARDANDO_RETIRADA]: DeliveryStatus.RETIRADO,
      [DeliveryStatus.RETIRADO]: DeliveryStatus.EM_ROTA,
      [DeliveryStatus.EM_ROTA]: DeliveryStatus.ENTREGUE,
    };
    if (expected[current] !== next) {
      throw new BadRequestException(`Transição de entrega inválida: ${current} → ${next}.`);
    }
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
