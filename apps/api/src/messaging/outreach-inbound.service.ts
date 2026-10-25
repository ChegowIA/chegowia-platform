import { Inject, Injectable } from "@nestjs/common";
import { OutreachTargetStatus, WhatsAppConversationMode } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { pediuParaNaoReceber } from "./outreach-contacts";
import { OUTREACH_CHANNEL_KEY } from "./outreach-intelligence";

/** Respostas do número dedicado: só CRM da prospecção, nunca fluxos Gupshup. */
@Injectable()
export class OutreachInboundService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}
  private db() { return this.prisma as any; }

  async record(phone: string, providerMessageId: string, text: string) {
    if (!providerMessageId || !text) return;
    const optedOut = pediuParaNaoReceber(text);
    if (optedOut) await this.db().$transaction(async (tx: any) => {
      await tx.platformOutreachBlock.upsert({ where: { phone },
        create: { phone, reason: "pediu para não receber no WhatsApp" }, update: {} });
      await tx.platformOutreachTarget.updateMany({ where: { phone, status: OutreachTargetStatus.PENDENTE },
        data: { status: OutreachTargetStatus.DESCARTADO, discardReason: "pediu para não receber", consentStatus: "NEGADO" } });
    });
    const channel = await this.db().platformWhatsAppChannel.findUnique({ where: { key: OUTREACH_CHANNEL_KEY } });
    if (!channel) return;
    if (await this.db().platformWhatsAppMessage.findUnique({ where: { providerMessageId } })) return;
    const target = await this.db().platformOutreachTarget.findFirst({ where: {
      phone, campaign: { channelId: channel.id }, status: { in: [OutreachTargetStatus.ENVIADO, OutreachTargetStatus.RESPONDEU] },
    }, orderBy: { sentAt: "desc" } });
    if (!target) return;
    try {
      await this.db().$transaction(async (tx: any) => {
        const conversation = await tx.platformWhatsAppConversation.upsert({
          where: { channelId_customerPhone: { channelId: channel.id, customerPhone: phone } },
          create: { channelId: channel.id, customerPhone: phone, customerName: target.name,
            mode: WhatsAppConversationMode.HUMANO, lastMessageText: text, lastMessageAt: new Date(), lastInboundAt: new Date() },
          update: { mode: WhatsAppConversationMode.HUMANO, lastMessageText: text, lastMessageAt: new Date(), lastInboundAt: new Date() },
        });
        await tx.platformWhatsAppMessage.create({ data: {
          channelId: channel.id, conversationId: conversation.id, providerMessageId,
          direction: "RECEBIDA", status: "RECEBIDA", type: "text", body: text,
        } });
        if (target.status === OutreachTargetStatus.ENVIADO) {
          const changed = await tx.platformOutreachTarget.updateMany({ where: { id: target.id, status: OutreachTargetStatus.ENVIADO },
            data: { status: OutreachTargetStatus.RESPONDEU, repliedAt: new Date(), conversationId: conversation.id,
              responseText: text, ...(optedOut ? { responseCategory: "DESCADASTRO", responseClassifiedAt: new Date() } : {}) } });
          if (changed.count === 1) await tx.platformOutreachCampaign.update({ where: { id: target.campaignId }, data: { repliedCount: { increment: 1 } } });
        } else await tx.platformOutreachTarget.update({ where: { id: target.id }, data: {
          responseText: text, responseCategory: optedOut ? "DESCADASTRO" : null,
          responseClassifiedAt: optedOut ? new Date() : null, classificationAttempts: 0,
        } });
      });
    } catch (error) {
      // Eventos duplicados da biblioteca não podem duplicar a conversa nem o CRM.
      if ((error as { code?: string })?.code !== "P2002") throw error;
    }
  }
}
