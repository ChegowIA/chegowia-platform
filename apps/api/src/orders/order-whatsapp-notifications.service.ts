import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  MessagingChannelStatus,
  MessagingChannelType,
  OrderSource,
  OrderStatus,
  WhatsAppConversationMode,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
} from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { runsBackgroundJobs } from "../common/config/app-role";
import { tenantContext } from "../common/tenant/tenant-context";
import { GupshupWhatsAppProvider } from "../messaging/providers/gupshup-whatsapp.provider";
import { MessagingSecretsService } from "../messaging/messaging-secrets.service";
import { UsageService } from "../usage/usage.service";

const POLL_MS = 5_000;
const SERVICE_WINDOW_MS = 23 * 60 * 60 * 1_000 + 50 * 60 * 1_000;
const MAX_ATTEMPTS = 5;

const STATUS_TEXT: Record<OrderStatus, string> = {
  RECEBIDO: "recebido pela loja",
  CONFIRMADO: "confirmado",
  EM_PREPARO: "em preparo",
  PRONTO: "pronto",
  SAIU_PARA_ENTREGA: "a caminho da entrega",
  ENTREGUE: "entregue",
  CANCELADO: "cancelado",
};

/**
 * Envio transacional, separado do assistente: a IA atende respostas, mas não
 * inventa status nem dispara mensagens por conta própria. A outbox é gravada
 * junto da mudança do pedido, e este worker só processa registros novos.
 */
@Injectable()
export class OrderWhatsAppNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderWhatsAppNotificationsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly gupshup: GupshupWhatsAppProvider,
    private readonly secrets: MessagingSecretsService,
    private readonly usage: UsageService,
  ) {}

  private db() { return this.prisma as any; }

  onModuleInit() {
    if (!runsBackgroundJobs()) return;
    this.timer = setInterval(() => void this.processPending(), POLL_MS);
    this.timer.unref();
    void this.processPending();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async processPending() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      // Uma queda depois de o provedor aceitar e antes do registro é ambígua.
      // Não reenviamos automaticamente: isso poderia duplicar o aviso.
      await this.db().orderWhatsAppNotification.updateMany({
        where: { state: "SENDING", lockedUntil: { lt: now } },
        data: { state: "UNKNOWN", lastError: "Envio interrompido; confira no Gupshup antes de reenviar." },
      });
      const pending = await this.db().orderWhatsAppNotification.findMany({
        where: { state: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: now } },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      for (const notification of pending) await this.processOne(notification);
    } catch (error) {
      this.logger.error("Falha no worker de avisos de pedido", error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }

  private async processOne(notification: any) {
    const claimed = await this.db().orderWhatsAppNotification.updateMany({
      where: { id: notification.id, state: notification.state },
      data: {
        state: "SENDING",
        attempts: { increment: 1 },
        lockedUntil: new Date(Date.now() + 2 * 60_000),
      },
    });
    if (claimed.count !== 1) return;

    let accepted = false;
    let sendStarted = false;
    try {
      await tenantContext.runAsCompany(notification.companyId, async () => {
        const order = await this.db().order.findFirst({
          where: { id: notification.orderId, companyId: notification.companyId },
          include: { customer: { select: { name: true } }, company: { select: { name: true } }, whatsappConversation: true },
        });
        if (!order || order.customerPhone !== notification.phone) {
          await this.finish(notification.id, "SKIPPED", "Pedido ou telefone não disponível.");
          return;
        }
        // Pedido do site requer consentimento explícito fotografado no pedido.
        if (order.source === OrderSource.SITE && !order.whatsappNotificationConsentAt) {
          await this.finish(notification.id, "SKIPPED", "Cliente não autorizou avisos pelo WhatsApp.");
          return;
        }
        if (!this.gupshup.isEnabled()) {
          throw new Error("Integração do Gupshup desativada.");
        }
        const channel = await this.db().messagingChannel.findUnique({
          where: { companyId_type: { companyId: notification.companyId, type: MessagingChannelType.WHATSAPP } },
        });
        if (!channel || channel.status !== MessagingChannelStatus.ATIVO || !channel.gupshupAppName) {
          throw new Error("WhatsApp da loja desconectado.");
        }
        const config = channelConfig(channel);
        const conversation = order.whatsappConversation ?? await this.db().whatsAppConversation.findUnique({
          where: { channelId_customerPhone: { channelId: channel.id, customerPhone: notification.phone } },
        });
        const inWindow = Boolean(conversation?.lastInboundAt && Date.now() - new Date(conversation.lastInboundAt).getTime() < SERVICE_WINDOW_MS);
        const canUseTemplate = Boolean(order.whatsappNotificationConsentAt && (
          this.gupshup.mode() === "PARTNER" ? config.orderUpdateTemplateName : config.orderUpdateTemplateId
        ));
        if (!inWindow && !order.whatsappNotificationConsentAt) {
          await this.finish(notification.id, "SKIPPED", "Janela de 24h encerrada ou modelo Utility não configurado; aviso não enviado.");
          return;
        }

        const useTemplate = order.source === OrderSource.SITE || !inWindow;
        if (useTemplate && !canUseTemplate) {
          if (["PENDING", "ERROR"].includes(config.orderUpdateTemplateState)) {
            await this.db().orderWhatsAppNotification.update({
              where: { id: notification.id },
              data: {
                state: "RETRY",
                attempts: { decrement: 1 },
                nextAttemptAt: new Date(Date.now() + 10 * 60_000),
                lockedUntil: null,
                lastError: "Modelo Utility em aprovação no Gupshup.",
              },
            });
          } else {
            await this.finish(notification.id, "SKIPPED", "Modelo Utility não aprovado; aviso não enviado.");
          }
          return;
        }

        const shortCode = order.id.slice(-6).toUpperCase();
        const body = orderMessage(order.company.name, shortCode, notification.orderStatus);
        const params = {
          appId: channel.gupshupAppId ?? "",
          appToken: await this.appTokenFor(channel),
          source: config.number ?? null,
          appName: channel.gupshupAppName,
          to: notification.phone,
        };
        // Site: modelo aprovado mesmo que exista uma conversa antiga. WhatsApp:
        // texto livre somente enquanto a janela do próprio cliente está aberta.
        sendStarted = true;
        const sent = useTemplate
          ? await this.gupshup.sendTemplate({
            ...params,
            templateId: config.orderUpdateTemplateId ?? null,
            templateName: config.orderUpdateTemplateName ?? null,
            languageCode: config.orderUpdateTemplateLanguage || "pt_BR",
            variables: [order.customerName || order.customer?.name || "cliente", shortCode, order.company.name, STATUS_TEXT[notification.orderStatus]],
          })
          : await this.gupshup.sendText({ ...params, body });
        accepted = true;

        const savedConversation = conversation ?? await this.db().whatsAppConversation.upsert({
          where: { channelId_customerPhone: { channelId: channel.id, customerPhone: notification.phone } },
          create: {
            companyId: notification.companyId,
            channelId: channel.id,
            customerPhone: notification.phone,
            customerName: order.customerName || order.customer?.name || null,
            mode: channel.automationEnabled ? WhatsAppConversationMode.VIRTUAL : WhatsAppConversationMode.HUMANO,
          },
          update: {},
        });
        const usage = await this.usage.recordWhatsAppUsage({
          companyId: notification.companyId,
          channelId: channel.id,
          providerMessageId: sent.messageId,
          pricingCategory: useTemplate ? "utility" : "service",
        });
        await this.db().whatsAppMessage.create({
          data: {
            companyId: notification.companyId,
            channelId: channel.id,
            conversationId: savedConversation.id,
            providerMessageId: sent.messageId,
            direction: WhatsAppMessageDirection.ENVIADA,
            status: WhatsAppMessageStatus.ENVIADA,
            type: useTemplate ? "order_update_template" : "order_update",
            body,
            pricingCategory: useTemplate ? "utility" : "service",
            providerCost: usage?.providerAmount ?? 0,
            billableAmount: usage?.billableAmount ?? 0,
            rawPayload: sent.raw as any,
          },
        });
        await this.db().whatsAppConversation.update({
          where: { id: savedConversation.id },
          data: { lastMessageText: body, lastMessageAt: new Date() },
        });
        await this.db().orderWhatsAppNotification.update({
          where: { id: notification.id },
          data: { state: "SENT", sentAt: new Date(), providerMessageId: sent.messageId, lockedUntil: null, lastError: null },
        });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 500) : "Falha no envio pelo WhatsApp.";
      this.logger.warn(`Aviso ${notification.id}: ${detail}`);
      if (accepted || (sendStarted && detail.includes("Não foi possível alcançar a API do Gupshup"))) {
        await this.finish(notification.id, "UNKNOWN", accepted
          ? `Provedor aceitou o aviso; falha no registro local: ${detail}`
          : `Falha de rede durante o envio; confirme no Gupshup antes de tentar novamente: ${detail}`);
      } else {
        const attempts = notification.attempts + 1;
        await this.db().orderWhatsAppNotification.update({
          where: { id: notification.id },
          data: {
            state: attempts >= MAX_ATTEMPTS ? "FAILED" : "RETRY",
            nextAttemptAt: new Date(Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** (attempts - 1))),
            lockedUntil: null,
            lastError: detail,
          },
        });
      }
    }
  }

  private async finish(id: string, state: string, lastError: string) {
    await this.db().orderWhatsAppNotification.update({
      where: { id }, data: { state, lastError, lockedUntil: null },
    });
  }

  private async appTokenFor(channel: any): Promise<string> {
    if (this.gupshup.mode() === "SELF_SERVE") return "";
    const expiresAt = channel.gupshupAppTokenExpiresAt as Date | null;
    if (channel.gupshupAppTokenEncrypted && expiresAt && expiresAt.getTime() > Date.now() + 60_000) {
      return this.secrets.decrypt(channel.gupshupAppTokenEncrypted);
    }
    const renewed = await this.gupshup.fetchAppToken(channel.gupshupAppId);
    await this.db().messagingChannel.update({
      where: { id: channel.id },
      data: { gupshupAppTokenEncrypted: this.secrets.encrypt(renewed.token), gupshupAppTokenExpiresAt: renewed.expiresAt },
    });
    return renewed.token;
  }
}

function channelConfig(channel: any): Record<string, any> {
  return channel?.config && typeof channel.config === "object" && !Array.isArray(channel.config) ? channel.config : {};
}

export function orderMessage(companyName: string, shortCode: string, status: OrderStatus) {
  const lines = [`${companyName} · pedido #${shortCode}`, `Atualização: ${STATUS_TEXT[status]}.`];
  lines.push("Se precisar de ajuda, responda esta mensagem.");
  return lines.join("\n");
}
