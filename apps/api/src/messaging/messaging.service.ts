import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MessagingChannelType } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { MESSAGING_PROVIDER, MessagingProvider } from "./providers/messaging-provider.interface";

@Injectable()
export class MessagingService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
  ) {}

  private db() {
    return this.prisma as any;
  }

  getWhatsappChannel() {
    return this.db().messagingChannel.findFirst({ where: { type: MessagingChannelType.WHATSAPP } });
  }

  async upsertWhatsappNumber(companyId: string, number: string) {
    return this.db().messagingChannel.upsert({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
      create: { companyId, type: MessagingChannelType.WHATSAPP, config: { number } },
      update: { config: { number } },
    });
  }

  private orderSummaryText(order: any, companyName: string): string {
    const lines = [
      `Olá, ${companyName}! Meu pedido #${order.id.slice(-6).toUpperCase()}:`,
      ...order.items.map(
        (item: any) =>
          `• ${item.quantity}x ${item.productName}${item.variationName ? ` (${item.variationName})` : ""} — R$ ${Number(item.totalPrice).toFixed(2)}`,
      ),
      `Subtotal: R$ ${Number(order.subtotal).toFixed(2)}`,
      `Entrega: R$ ${Number(order.deliveryFee).toFixed(2)}`,
      `Total: R$ ${Number(order.total).toFixed(2)}`,
      `Endereço: ${order.deliveryStreet}, ${order.deliveryNumber} - ${order.deliveryNeighborhood}, ${order.deliveryCity}/${order.deliveryState}`,
      `Pagamento: ${order.paymentMethod}`,
    ];
    return lines.join("\n");
  }

  async buildOrderContactLink(orderId: string) {
    const order = await this.db().order.findUnique({ where: { id: orderId }, include: { items: true, company: true } });
    if (!order) throw new NotFoundException("Pedido não encontrado.");
    return this.linkForOrder(order);
  }

  async buildOrderContactLinkForCustomer(orderId: string, customerId: string) {
    const order = await this.db().order.findFirst({
      where: { id: orderId, customerId },
      include: { items: true, company: true },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado.");
    return this.linkForOrder(order);
  }

  private linkForOrder(order: any) {
    const summary = this.orderSummaryText(order, order.company.name);
    const phone = order.company.whatsapp ?? order.company.phone;
    if (!phone) throw new NotFoundException("Empresa não tem WhatsApp configurado.");
    return { link: this.provider.buildContactLink(phone, summary), summary };
  }

  async buildStoreContactLink(companySlug: string) {
    const company = await this.db().company.findFirst({ where: { slug: companySlug, isActive: true } });
    if (!company?.whatsapp) throw new NotFoundException("Empresa não tem WhatsApp configurado.");

    const message = `Olá, ${company.name}! Vim pelo site e gostaria de fazer um pedido.`;
    return { link: this.provider.buildContactLink(company.whatsapp, message) };
  }
}
