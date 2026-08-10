import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  MessagingChannelStatus,
  MessagingChannelType,
  SubscriptionStatus,
  WhatsAppConversationMode,
  WhatsAppConversationStatus,
  WhatsAppOrderDraftStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
} from "@prisma/client";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";
import { AiService } from "../ai/ai.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { UsageService } from "../usage/usage.service";
import { ConnectWhatsAppCloudDto } from "./dto/connect-whatsapp-cloud.dto";
import { CompleteWhatsAppEmbeddedSignupDto } from "./dto/complete-whatsapp-embedded-signup.dto";
import { UpdateWhatsAppAutomationDto } from "./dto/update-whatsapp-automation.dto";
import { UpdateWhatsAppConversationDto } from "./dto/update-whatsapp-conversation.dto";
import { MessagingSecretsService } from "./messaging-secrets.service";
import { MetaWhatsAppProvider } from "./providers/meta-whatsapp.provider";
import { MESSAGING_PROVIDER, MessagingProvider } from "./providers/messaging-provider.interface";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { TemporaryTestModeService } from "../common/test-mode/test-mode.service";

const MAX_WHATSAPP_TEXT_LENGTH = 4096;

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
    private readonly meta: MetaWhatsAppProvider,
    private readonly secrets: MessagingSecretsService,
    private readonly ai: AiService,
    private readonly usage: UsageService,
    private readonly realtime: RealtimeGateway,
    private readonly temporaryTestMode?: TemporaryTestModeService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  async getWhatsappChannel(companyId: string) {
    const channel = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    return channel ? this.channelSummary(channel) : this.emptyChannelSummary();
  }

  async upsertWhatsappNumber(companyId: string, number: string) {
    const normalizedNumber = normalizePhone(number);
    if (normalizedNumber.length < 10) {
      throw new BadRequestException("Informe o número do WhatsApp com DDI e DDD.");
    }
    const current = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    const channel = await this.db().messagingChannel.upsert({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
      create: { companyId, type: MessagingChannelType.WHATSAPP, config: { number: normalizedNumber } },
      update: { config: { ...channelConfig(current), number: normalizedNumber } },
    });
    return this.channelSummary(channel);
  }

  async connectWhatsappCloud(companyId: string, dto: ConnectWhatsAppCloudDto) {
    this.assertCloudApiEnabled();
    const accessToken = dto.accessToken.trim();
    const phoneNumberId = dto.phoneNumberId.trim();
    const businessAccountId = dto.businessAccountId.trim();
    const details = await this.meta.getPhoneNumber(phoneNumberId, accessToken);
    if (details.id !== phoneNumberId) {
      throw new BadRequestException("O identificador do número retornado pela Meta não confere.");
    }
    // A conexão técnica é usada principalmente para número de teste/suporte. Sem
    // assinar o WABA, o app até consegue enviar, mas não recebe o webhook e não
    // cria a conversa na Central de atendimento para a demonstração/revisão Meta.
    await this.meta.subscribeAppToBusinessAccount({ businessAccountId, accessToken });

    return this.saveWhatsappCloudConnection({
      companyId,
      phoneNumberId,
      businessAccountId,
      accessToken,
      displayPhoneNumber: details.displayPhoneNumber,
      verifiedName: details.verifiedName,
      qualityRating: details.qualityRating,
      automationEnabled: dto.automationEnabled,
      welcomeMessage: dto.welcomeMessage,
      source: "MANUAL",
    });
  }

  /**
   * Informações públicas necessárias para abrir o popup oficial da Meta. Não há
   * token nem App Secret nesta resposta.
   */
  embeddedSignupConfiguration() {
    const appId = process.env.META_APP_ID?.trim() || null;
    const configurationId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || null;
    const featureEnabled = process.env.META_EMBEDDED_SIGNUP_ENABLED === "true";
    const cloudEnabled = process.env.WHATSAPP_CLOUD_API_ENABLED === "true";
    const secretConfigured = Boolean(process.env.META_APP_SECRET?.trim());
    const enabled = featureEnabled && cloudEnabled && secretConfigured && Boolean(appId && configurationId);
    return {
      enabled,
      appId: enabled ? appId : null,
      configurationId: enabled ? configurationId : null,
      graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v22.0",
      reason: enabled ? null : "A conexão automática com a Meta ainda está sendo preparada pela plataforma.",
    };
  }

  /**
   * Finaliza o Embedded Signup. O código vindo do popup é de uso único e é
   * trocado por token somente aqui, depois de validar o WABA e o número na Meta.
   */
  async completeWhatsAppEmbeddedSignup(companyId: string, dto: CompleteWhatsAppEmbeddedSignupDto) {
    const setup = this.embeddedSignupConfiguration();
    const appSecret = process.env.META_APP_SECRET?.trim();
    if (!setup.enabled || !setup.appId || !appSecret) {
      throw new BadRequestException("A conexão automática com a Meta ainda não está disponível.");
    }

    const phoneNumberId = dto.phoneNumberId.trim();
    const businessAccountId = dto.businessAccountId.trim();
    // `metaPhoneNumberId` é globalmente único. A consulta usa bypass apenas para
    // detectar colisão antes de chamar a Meta; nenhum dado desse outro tenant sai.
    const existingOwner = await this.globalPhoneNumberOwner(phoneNumberId);
    if (existingOwner && existingOwner.companyId !== companyId) {
      throw new ConflictException("Este número da Meta já está vinculado a outra empresa.");
    }

    try {
      const credential = await this.meta.exchangeEmbeddedSignupCode({
        appId: setup.appId,
        appSecret,
        code: dto.code.trim(),
      });
      const businessPortfolioId = dto.businessPortfolioId?.trim() || null;
      if (businessPortfolioId) {
        // Não confiamos apenas no ID entregue ao navegador pela Meta. A API
        // confirma que a credencial trocada no servidor realmente pode ler o
        // Business Portfolio escolhido antes de vincular qualquer ativo a este
        // tenant.
        const businessPortfolio = await this.meta.getBusinessPortfolio(businessPortfolioId, credential.accessToken);
        if (businessPortfolio.id !== businessPortfolioId) {
          throw new BadRequestException("A Meta não confirmou o Business Portfolio escolhido para esta conexão.");
        }
      }

      const belongsToBusiness = await this.meta.businessHasPhoneNumber({
        businessAccountId,
        phoneNumberId,
        accessToken: credential.accessToken,
      });
      if (!belongsToBusiness) {
        throw new BadRequestException("A Meta não confirmou que o número escolhido pertence a esta conta do WhatsApp Business.");
      }

      const details = await this.meta.getPhoneNumber(phoneNumberId, credential.accessToken);
      if (details.id !== phoneNumberId) {
        throw new BadRequestException("O identificador do número retornado pela Meta não confere.");
      }

      // Números novos da Cloud API precisam ser registrados com PIN 2FA. Os fluxos
      // de coexistência/migração já possuem registro e não devem receber novo PIN.
      const registrationPin = dto.event === "FINISH" ? String(randomInt(100_000, 1_000_000)) : null;
      if (registrationPin) {
        await this.meta.registerPhoneNumber({
          phoneNumberId,
          accessToken: credential.accessToken,
          pin: registrationPin,
        });
      }
      await this.meta.subscribeAppToBusinessAccount({
        businessAccountId,
        accessToken: credential.accessToken,
      });

      const expiresAt = credential.expiresInSeconds
        ? new Date(Date.now() + credential.expiresInSeconds * 1000)
        : null;
      return this.saveWhatsappCloudConnection({
        companyId,
        phoneNumberId,
        businessAccountId,
        businessPortfolioId,
        accessToken: credential.accessToken,
        accessTokenExpiresAt: expiresAt,
        registrationPin,
        displayPhoneNumber: details.displayPhoneNumber,
        verifiedName: details.verifiedName,
        qualityRating: details.qualityRating,
        source: "EMBEDDED_SIGNUP",
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      // Não repassamos detalhes do Graph API ao empresário; eles podem incluir
      // informações do ativo Meta e não ajudam no caminho guiado.
      this.logger.warn(`Falha ao concluir Embedded Signup para a empresa ${companyId}.`);
      throw new BadRequestException("A Meta não conseguiu concluir a conexão agora. Feche a janela e tente novamente.");
    }
  }

  private assertCloudApiEnabled() {
    if (process.env.NODE_ENV === "production" && process.env.WHATSAPP_CLOUD_API_ENABLED !== "true") {
      throw new BadRequestException("A conexão com a WhatsApp Cloud API ainda não está habilitada.");
    }
  }

  private globalPhoneNumberOwner(phoneNumberId: string) {
    return tenantContext.run({ companyId: null, bypass: true }, () => {
      return this.db().messagingChannel.findUnique({ where: { metaPhoneNumberId: phoneNumberId } });
    });
  }

  private async saveWhatsappCloudConnection(params: {
    companyId: string;
    phoneNumberId: string;
    businessAccountId: string | null;
    businessPortfolioId?: string | null;
    accessToken: string;
    accessTokenExpiresAt?: Date | null;
    registrationPin?: string | null;
    displayPhoneNumber?: string | null;
    verifiedName?: string | null;
    qualityRating?: string | null;
    automationEnabled?: boolean;
    welcomeMessage?: string;
    source: "MANUAL" | "EMBEDDED_SIGNUP";
  }) {
    const current = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId: params.companyId, type: MessagingChannelType.WHATSAPP } },
    });
    const displayNumber = params.displayPhoneNumber ?? channelConfig(current).number ?? null;
    const commonData = {
      status: MessagingChannelStatus.ATIVO,
      config: displayNumber
        ? { ...channelConfig(current), number: normalizePhone(displayNumber) }
        : channelConfig(current),
      metaPhoneNumberId: params.phoneNumberId,
      metaBusinessAccountId: params.businessAccountId,
      metaBusinessPortfolioId: params.businessPortfolioId ?? null,
      metaAccessTokenEncrypted: this.secrets.encrypt(params.accessToken),
      metaAccessTokenExpiresAt: params.accessTokenExpiresAt ?? null,
      metaRegistrationPinEncrypted: params.registrationPin ? this.secrets.encrypt(params.registrationPin) : null,
      metaDisplayPhoneNumber: params.displayPhoneNumber ?? null,
      metaVerifiedName: params.verifiedName ?? null,
      metaQualityRating: params.qualityRating ?? null,
      ...(params.automationEnabled === undefined ? {} : { automationEnabled: params.automationEnabled }),
      ...(params.welcomeMessage === undefined ? {} : { welcomeMessage: params.welcomeMessage.trim() || null }),
      ...(params.source === "EMBEDDED_SIGNUP" ? { metaEmbeddedSignupAt: new Date() } : { metaEmbeddedSignupAt: null }),
      connectedAt: new Date(),
      lastError: null,
    };
    try {
      const channel = await this.db().messagingChannel.upsert({
        where: { companyId_type: { companyId: params.companyId, type: MessagingChannelType.WHATSAPP } },
        create: {
          companyId: params.companyId,
          type: MessagingChannelType.WHATSAPP,
          ...commonData,
          automationEnabled: params.automationEnabled ?? true,
          welcomeMessage: params.welcomeMessage?.trim() || null,
        },
        update: commonData,
      });
      if (displayNumber) {
        await this.db().company.updateMany({
          where: { id: params.companyId, whatsapp: null },
          data: { whatsapp: normalizePhone(displayNumber) },
        });
      }
      return this.channelSummary(channel);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException("Este número da Meta já está vinculado a outra empresa.");
      }
      throw error;
    }
  }

  async updateWhatsappAutomation(companyId: string, dto: UpdateWhatsAppAutomationDto) {
    const channel = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    if (!channel) throw new NotFoundException("Vincule primeiro um canal de WhatsApp.");
    const updated = await this.db().messagingChannel.update({
      where: { id: channel.id },
      data: {
        automationEnabled: dto.automationEnabled,
        welcomeMessage: dto.welcomeMessage === undefined ? undefined : dto.welcomeMessage.trim() || null,
      },
    });
    return this.channelSummary(updated);
  }

  webhookSetup() {
    return {
      url: `${publicApiUrl()}/api/messaging/webhooks/meta`,
      verificationConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
      signatureConfigured: Boolean(process.env.META_APP_SECRET),
      encryptionConfigured: this.secrets.isConfigured(),
    };
  }

  verifyWebhookChallenge(query: Record<string, unknown>) {
    const mode = String(query["hub.mode"] ?? "");
    const verifyToken = String(query["hub.verify_token"] ?? "");
    const challenge = String(query["hub.challenge"] ?? "");
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!expected || !challenge || mode !== "subscribe" || !safeEqual(verifyToken, expected)) {
      throw new UnauthorizedException("Verificação do webhook recusada.");
    }
    return challenge;
  }

  verifyWebhookSignature(rawBody: Buffer, signature?: string) {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !signature?.startsWith("sha256=")) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    return safeEqual(signature, expected);
  }

  async handleMetaWebhook(payload: any) {
    if (payload?.object !== "whatsapp_business_account") return { ignored: true };
    for (const entry of payload.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field !== "messages") continue;
        await this.handleMetaMessagesChange(change.value ?? {});
      }
    }
    return { received: true };
  }

  async listWhatsAppConversations(companyId: string) {
    const conversations = await this.db().whatsAppConversation.findMany({
      where: { companyId },
      orderBy: { lastMessageAt: "desc" },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        channel: {
          select: {
            id: true,
            metaDisplayPhoneNumber: true,
            metaVerifiedName: true,
            automationEnabled: true,
            status: true,
          },
        },
        orderDrafts: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            status: true,
            customerName: true,
            paymentMethod: true,
            addressStreet: true,
            addressNumber: true,
            addressNeighborhood: true,
            addressCity: true,
            addressState: true,
            quoteSnapshot: true,
            updatedAt: true,
          },
        },
        _count: { select: { messages: true } },
      },
    });
    return conversations.map(({ orderDrafts, ...conversation }: any) => ({
      ...conversation,
      orderDraft: orderDrafts[0] ?? null,
    }));
  }

  async getWhatsAppConversation(companyId: string, id: string) {
    const conversation = await this.db().whatsAppConversation.findFirst({
      where: { id, companyId },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        channel: {
          select: {
            id: true,
            status: true,
            metaDisplayPhoneNumber: true,
            metaVerifiedName: true,
            automationEnabled: true,
            metaQualityRating: true,
          },
        },
        company: {
          select: {
            id: true,
            name: true,
            phone: true,
            whatsapp: true,
            addressLine: true,
            city: true,
            state: true,
            deliveryFeeBase: true,
            deliveryFeePerKm: true,
            deliveryRadiusKm: true,
            avgDeliveryTimeMinutes: true,
            logoUrl: true,
            settings: {
              select: { openingHours: true, paymentMethodsEnabled: true, aiEnabled: true, aiKnowledgeBase: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          take: 300,
          include: { sentBy: { select: { id: true, name: true } } },
        },
        orderDrafts: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            status: true,
            customerName: true,
            paymentMethod: true,
            addressStreet: true,
            addressNumber: true,
            addressNeighborhood: true,
            addressCity: true,
            addressState: true,
            quoteSnapshot: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException("Conversa de WhatsApp não encontrada.");
    const { orderDrafts, ...rest } = conversation as any;
    return { ...rest, orderDraft: orderDrafts[0] ?? null };
  }

  async updateWhatsAppConversation(companyId: string, id: string, dto: UpdateWhatsAppConversationDto) {
    await this.getWhatsAppConversation(companyId, id);
    if (dto.assignedToUserId) {
      const assignee = await this.db().user.findFirst({
        where: { id: dto.assignedToUserId, companyId },
        select: { id: true },
      });
      if (!assignee) throw new BadRequestException("A pessoa selecionada não pertence a esta empresa.");
    }
    const data: any = {
      mode: dto.mode,
      status: dto.status,
      assignedToUserId: dto.assignedToUserId,
    };
    if (dto.mode === WhatsAppConversationMode.HUMANO) data.humanRequestedAt = new Date();
    const conversation = await this.db().whatsAppConversation.update({ where: { id }, data });
    this.realtime.emitToCompany(companyId, "whatsapp.conversation.updated", conversation);
    return conversation;
  }

  /**
   * O atendente pode recomeçar a conversa sem apagar pedidos e faturamento.
   *
   * O recorte por `companyId` aparece em todas as operações, inclusive nas
   * exclusões. Isso impede que um ID de outra empresa seja usado para limpar
   * mensagens de outro tenant. Também desvinculamos o contexto da IA e
   * cancelamos apenas o rascunho ainda aberto: assim um próximo contato não
   * herda itens, endereço ou instruções antigas.
   */
  async clearWhatsAppConversation(companyId: string, id: string) {
    const existing = await this.getWhatsAppConversation(companyId, id);
    const clearedAt = new Date();

    const result = await this.db().$transaction(async (tx: any) => {
      const deletedMessages = await tx.whatsAppMessage.deleteMany({
        where: { companyId, conversationId: existing.id },
      });
      await tx.whatsAppOrderDraft.updateMany({
        where: {
          companyId,
          conversationId: existing.id,
          activeKey: { not: null },
          status: {
            in: [WhatsAppOrderDraftStatus.MONTANDO, WhatsAppOrderDraftStatus.AGUARDANDO_CONFIRMACAO],
          },
        },
        data: {
          activeKey: null,
          status: WhatsAppOrderDraftStatus.CANCELADO,
          quoteSnapshot: null,
          quoteFingerprint: null,
          confirmationRequestedAt: null,
          lastError: "Rascunho cancelado ao limpar o atendimento.",
        },
      });
      const conversation = await tx.whatsAppConversation.update({
        where: { id_companyId: { id: existing.id, companyId } },
        data: {
          aiConversationId: null,
          lastMessageText: null,
          lastMessageAt: clearedAt,
          lastInboundAt: null,
        },
      });
      return { conversation, deletedMessages: deletedMessages.count };
    });

    this.realtime.emitToCompany(companyId, "whatsapp.conversation.updated", {
      conversationId: result.conversation.id,
    });
    return { id: result.conversation.id, clearedMessages: result.deletedMessages };
  }

  async sendHumanMessage(companyId: string, userId: string, conversationId: string, content: string) {
    const conversation = await this.getWhatsAppConversation(companyId, conversationId);
    const updated = await this.db().whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        mode: WhatsAppConversationMode.HUMANO,
        status: WhatsAppConversationStatus.ABERTA,
        assignedToUserId: userId,
        humanRequestedAt: conversation.humanRequestedAt ?? new Date(),
      },
      include: { channel: true },
    });
    return this.sendText(updated, updated.channel, content, userId, "text");
  }

  private async handleMetaMessagesChange(value: any) {
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) return;
    const channel = await this.db().messagingChannel.findUnique({
      where: { metaPhoneNumberId: String(phoneNumberId) },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            settings: { select: { aiEnabled: true } },
            subscription: { select: { status: true, trialEndsAt: true } },
          },
        },
      },
    });
    if (!channel || channel.status !== MessagingChannelStatus.ATIVO) {
      this.logger.warn(`Webhook WhatsApp ignorado: número Meta não vinculado (${String(phoneNumberId)}).`);
      return;
    }
    await this.db().messagingChannel.update({
      where: { id: channel.id },
      data: { lastWebhookAt: new Date(), lastError: null },
    });

    for (const status of value.statuses ?? []) {
      await this.processMessageStatus(channel, status, value);
    }
    for (const message of value.messages ?? []) {
      await this.processIncomingMessage(channel, value.contacts ?? [], message, value);
    }
  }

  private async processMessageStatus(channel: any, status: any, rawPayload: any) {
    const providerMessageId = String(status?.id ?? "");
    if (!providerMessageId) return;
    const existing = await this.db().whatsAppMessage.findUnique({ where: { providerMessageId } });
    if (!existing) return;
    const mappedStatus = mapProviderStatus(status?.status);
    const pricingCategory = status?.pricing?.category ? String(status.pricing.category) : undefined;
    const error = status?.errors?.[0];
    const usage = pricingCategory && existing.direction === WhatsAppMessageDirection.ENVIADA
      ? await this.usage.repriceWhatsAppUsage({
          companyId: existing.companyId,
          channelId: existing.channelId,
          providerMessageId,
          pricingCategory,
          billable: status?.pricing?.billable === false ? false : undefined,
        })
      : null;
    await this.db().whatsAppMessage.update({
      where: { id: existing.id },
      data: {
        status: mappedStatus,
        pricingCategory,
        providerCost: usage?.providerAmount,
        billableAmount: usage?.billableAmount,
        errorCode: error?.code ? String(error.code) : undefined,
        errorMessage: error?.title ? String(error.title) : undefined,
        rawPayload,
      },
    });
    if (mappedStatus === WhatsAppMessageStatus.FALHOU) {
      await this.db().messagingChannel.update({
        where: { id: channel.id },
        data: { lastError: error?.title ? String(error.title) : "Falha no envio confirmada pela Meta." },
      });
    }
  }

  private async processIncomingMessage(channel: any, contacts: any[], message: any, rawPayload: any) {
    const providerMessageId = String(message?.id ?? "");
    const customerPhone = normalizePhone(String(message?.from ?? ""));
    if (!providerMessageId || !customerPhone) return;
    const duplicated = await this.db().whatsAppMessage.findUnique({ where: { providerMessageId } });
    if (duplicated) return;

    const contact = contacts.find((item) => String(item?.wa_id ?? "") === customerPhone);
    const customerName = contact?.profile?.name ? String(contact.profile.name).slice(0, 191) : null;
    const parsed = incomingContent(message);
    const existing = await this.db().whatsAppConversation.findUnique({
      where: { channelId_customerPhone: { channelId: channel.id, customerPhone } },
    });
    const automationAllowed = this.canRunWhatsAppAutomation(channel);
    const initialMode = automationAllowed && channel.automationEnabled && channel.company.settings?.aiEnabled !== false
      ? WhatsAppConversationMode.VIRTUAL
      : WhatsAppConversationMode.HUMANO;
    const conversation = await this.db().whatsAppConversation.upsert({
      where: { channelId_customerPhone: { channelId: channel.id, customerPhone } },
      create: {
        companyId: channel.companyId,
        channelId: channel.id,
        customerPhone,
        customerName,
        mode: initialMode,
        lastMessageText: parsed.text,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        humanRequestedAt: initialMode === WhatsAppConversationMode.HUMANO ? new Date() : null,
      },
      update: {
        customerName: customerName ?? undefined,
        status: WhatsAppConversationStatus.ABERTA,
        lastMessageText: parsed.text,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
      },
    });

    try {
      await this.db().whatsAppMessage.create({
        data: {
          companyId: channel.companyId,
          channelId: channel.id,
          conversationId: conversation.id,
          providerMessageId,
          direction: WhatsAppMessageDirection.RECEBIDA,
          status: WhatsAppMessageStatus.RECEBIDA,
          type: String(message?.type ?? "text"),
          body: parsed.text,
          rawPayload,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) return;
      throw error;
    }
    this.realtime.emitToCompany(channel.companyId, "whatsapp.message.received", { conversationId: conversation.id });
    this.realtime.emitToCompany(channel.companyId, "whatsapp.conversation.updated", conversation);

    // O webhook continua registrando a mensagem recebida para não perder o
    // histórico, mas depois do teste não envia menu, resposta humana ou IA.
    // Assim o número não gera novas despesas de Meta/DeepSeek enquanto o
    // acesso do empresário está bloqueado aguardando ativação paga.
    if (!automationAllowed) {
      this.logger.log(`Automação WhatsApp pausada para a empresa ${channel.companyId}: assinatura sem acesso.`);
      return;
    }

    const requestedMode = selectionFromIncoming(parsed);
    if (requestedMode === WhatsAppConversationMode.HUMANO) {
      await this.handoffToHuman(conversation, channel, "Perfeito! Encaminhei sua conversa para uma pessoa da equipe. Aguarde só um instante.");
      return;
    }
    if (requestedMode === WhatsAppConversationMode.VIRTUAL) {
      const virtual = await this.db().whatsAppConversation.update({
        where: { id: conversation.id },
        data: { mode: WhatsAppConversationMode.VIRTUAL, status: WhatsAppConversationStatus.ABERTA },
      });
      await this.sendText(virtual, channel, "Perfeito! Sou o atendente virtual da empresa. Como posso ajudar?", undefined, "text");
      return;
    }

    if (!channel.automationEnabled || channel.company.settings?.aiEnabled === false) {
      if (!existing || conversation.mode !== WhatsAppConversationMode.HUMANO) {
        await this.handoffToHuman(conversation, channel, "Recebemos sua mensagem. Uma pessoa da equipe vai continuar seu atendimento em breve.");
      }
      return;
    }

    if (!existing) {
      const greeting = personalizedWelcome(channel.welcomeMessage, channel.company.name);
      await this.sendChoiceMenu(conversation, channel, greeting);
      return;
    }

    if (conversation.mode === WhatsAppConversationMode.HUMANO) return;
    await this.answerWithVirtualAgent(conversation, channel, parsed.text);
  }

  private async handoffToHuman(conversation: any, channel: any, text: string) {
    const updated = await this.db().whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        mode: WhatsAppConversationMode.HUMANO,
        status: WhatsAppConversationStatus.ABERTA,
        humanRequestedAt: new Date(),
      },
    });
    this.realtime.emitToCompany(channel.companyId, "whatsapp.conversation.updated", updated);
    await this.sendText(updated, channel, text, undefined, "text");
  }

  private async answerWithVirtualAgent(conversation: any, channel: any, input: string) {
    let aiConversationId = conversation.aiConversationId;
    if (!aiConversationId) {
      const created = await this.ai.startWhatsAppConversation(conversation.companyId, conversation.customerPhone);
      try {
        const linked = await this.db().whatsAppConversation.update({
          where: { id: conversation.id },
          data: { aiConversationId: created.id },
        });
        aiConversationId = linked.aiConversationId;
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        const current = await this.db().whatsAppConversation.findUnique({ where: { id: conversation.id } });
        aiConversationId = current?.aiConversationId;
      }
    }
    if (!aiConversationId) throw new BadRequestException("Não foi possível preparar o contexto do atendente virtual.");

    try {
      const result = await this.ai.sendMessage(aiConversationId, input);
      const answer = result.message.content.trim() || "Posso te ajudar com informações da empresa, cardápio, pedidos e entregas. O que você precisa?";
      const latest = await this.db().whatsAppConversation.findUnique({ where: { id: conversation.id } });
      if (latest?.mode === WhatsAppConversationMode.VIRTUAL) {
        await this.sendText(latest, channel, answer, undefined, "text");
      }
    } catch (error) {
      this.logger.error(`Atendente virtual indisponível para a conversa ${conversation.id}`, error instanceof Error ? error.stack : String(error));
      await this.handoffToHuman(
        conversation,
        channel,
        "O atendente virtual está indisponível agora. Encaminhei você para uma pessoa da equipe.",
      );
    }
  }

  private async sendChoiceMenu(conversation: any, channel: any, body: string) {
    const token = this.accessTokenFor(channel);
    try {
      const sent = await this.sendToMetaRecipient(
        conversation.customerPhone,
        (to) => this.meta.sendChoiceMenu({
          phoneNumberId: channel.metaPhoneNumberId,
          accessToken: token,
          to,
          body: truncateWhatsappText(body),
        }),
      );
      return this.persistOutbound(conversation, channel, {
        providerMessageId: sent.messageId,
        body,
        type: "interactive",
        rawPayload: sent.raw,
      });
    } catch (error) {
      await this.persistFailedOutbound(conversation, channel, body, "interactive", error);
      throw error;
    }
  }

  private async sendText(conversation: any, channel: any, content: string, sentByUserId?: string, type = "text") {
    const body = truncateWhatsappText(content);
    const token = this.accessTokenFor(channel);
    try {
      const sent = await this.sendToMetaRecipient(
        conversation.customerPhone,
        (to) => this.meta.sendText({
          phoneNumberId: channel.metaPhoneNumberId,
          accessToken: token,
          to,
          body,
        }),
      );
      return this.persistOutbound(conversation, channel, {
        providerMessageId: sent.messageId,
        body,
        type,
        sentByUserId,
        rawPayload: sent.raw,
      });
    } catch (error) {
      await this.persistFailedOutbound(conversation, channel, body, type, error, sentByUserId);
      throw error;
    }
  }

  /**
   * Na lista de destinatários de números de teste, a Meta compara o número de
   * forma estrita. Para alguns celulares brasileiros, o webhook chega sem o
   * nono dígito, enquanto o cadastro na lista aceita/exige o número completo.
   * Só tentamos a alternativa depois da recusa #131030 — isto evita trocar o
   * destino em situações normais de produção.
   */
  private async sendToMetaRecipient<T>(customerPhone: string, send: (to: string) => Promise<T>): Promise<T> {
    const normalizedPhone = normalizePhone(customerPhone);
    try {
      return await send(normalizedPhone);
    } catch (error) {
      const alternatePhone = brazilianRecipientWithNinthDigit(normalizedPhone);
      if (!alternatePhone || !isMetaRecipientNotAllowedError(error)) throw error;

      this.logger.warn(
        `A Meta recusou o destinatário brasileiro ${maskPhone(normalizedPhone)} na lista de teste; tentando a variante com nono dígito.`,
      );
      return send(alternatePhone);
    }
  }

  private async persistOutbound(
    conversation: any,
    channel: any,
    data: { providerMessageId: string | null; body: string; type: string; sentByUserId?: string; rawPayload: unknown },
  ) {
    const usage = await this.usage.recordWhatsAppUsage({
      companyId: conversation.companyId,
      channelId: channel.id,
      providerMessageId: data.providerMessageId,
      pricingCategory: "service",
    });
    const message = await this.db().whatsAppMessage.create({
      data: {
        companyId: conversation.companyId,
        channelId: channel.id,
        conversationId: conversation.id,
        providerMessageId: data.providerMessageId,
        direction: WhatsAppMessageDirection.ENVIADA,
        status: WhatsAppMessageStatus.ENVIADA,
        type: data.type,
        body: data.body,
        pricingCategory: "service",
        providerCost: usage?.providerAmount ?? 0,
        billableAmount: usage?.billableAmount ?? 0,
        sentByUserId: data.sentByUserId,
        rawPayload: data.rawPayload as any,
      },
    });
    const updatedConversation = await this.db().whatsAppConversation.update({
      where: { id: conversation.id },
      data: { lastMessageText: data.body, lastMessageAt: new Date() },
    });
    await this.db().messagingChannel.update({ where: { id: channel.id }, data: { lastError: null } });
    this.realtime.emitToCompany(conversation.companyId, "whatsapp.message.sent", { conversationId: conversation.id, messageId: message.id });
    this.realtime.emitToCompany(conversation.companyId, "whatsapp.conversation.updated", updatedConversation);
    return message;
  }

  private async persistFailedOutbound(
    conversation: any,
    channel: any,
    body: string,
    type: string,
    error: unknown,
    sentByUserId?: string,
  ) {
    const safeMessage = error instanceof Error ? error.message.slice(0, 1000) : "Falha no envio pelo WhatsApp.";
    const message = await this.db().whatsAppMessage.create({
      data: {
        companyId: conversation.companyId,
        channelId: channel.id,
        conversationId: conversation.id,
        direction: WhatsAppMessageDirection.ENVIADA,
        status: WhatsAppMessageStatus.FALHOU,
        type,
        body,
        sentByUserId,
        errorMessage: safeMessage,
      },
    });
    await this.db().messagingChannel.update({ where: { id: channel.id }, data: { lastError: safeMessage } });
    this.realtime.emitToCompany(conversation.companyId, "whatsapp.message.sent", { conversationId: conversation.id, messageId: message.id });
  }

  private accessTokenFor(channel: any) {
    if (
      channel.status !== MessagingChannelStatus.ATIVO
      || !channel.metaPhoneNumberId
      || !channel.metaAccessTokenEncrypted
    ) {
      throw new BadRequestException("Este canal não está conectado à WhatsApp Cloud API.");
    }
    return this.secrets.decrypt(channel.metaAccessTokenEncrypted);
  }

  private canRunWhatsAppAutomation(channel: any) {
    const subscription = channel.company?.subscription;
    const trialActive = subscription?.status === SubscriptionStatus.EM_TESTE
      && Boolean(subscription.trialEndsAt && subscription.trialEndsAt.getTime() > Date.now());
    const trialExpired = subscription?.status === SubscriptionStatus.EM_TESTE
      && Boolean(subscription.trialEndsAt && subscription.trialEndsAt.getTime() <= Date.now());
    if (trialExpired) return false;
    const enforceBilling = process.env.BILLING_ENFORCEMENT === "true"
      || (process.env.NODE_ENV === "production" && process.env.BILLING_ENFORCEMENT !== "false");
    return !enforceBilling || subscription?.status === SubscriptionStatus.ATIVA || trialActive;
  }

  private channelSummary(channel: any) {
    const config = channelConfig(channel);
    return {
      id: channel.id,
      status: channel.status,
      number: config.number ?? channel.metaDisplayPhoneNumber ?? null,
      automationEnabled: Boolean(channel.automationEnabled),
      welcomeMessage: channel.welcomeMessage ?? null,
      connected: Boolean(channel.metaPhoneNumberId && channel.metaAccessTokenEncrypted && channel.status === MessagingChannelStatus.ATIVO),
      integration: {
        phoneNumberId: channel.metaPhoneNumberId ?? null,
        businessAccountId: channel.metaBusinessAccountId ?? null,
        businessPortfolioId: channel.metaBusinessPortfolioId ?? null,
        displayPhoneNumber: channel.metaDisplayPhoneNumber ?? null,
        verifiedName: channel.metaVerifiedName ?? null,
        qualityRating: channel.metaQualityRating ?? null,
        connectedAt: channel.connectedAt ?? null,
        accessTokenExpiresAt: channel.metaAccessTokenExpiresAt ?? null,
        embeddedSignupAt: channel.metaEmbeddedSignupAt ?? null,
        lastWebhookAt: channel.lastWebhookAt ?? null,
        lastError: channel.lastError ?? null,
      },
      webhook: this.webhookSetup(),
    };
  }

  private emptyChannelSummary() {
    return {
      id: null,
      status: MessagingChannelStatus.INATIVO,
      number: null,
      automationEnabled: true,
      welcomeMessage: null,
      connected: false,
      integration: {
        phoneNumberId: null,
        businessAccountId: null,
        businessPortfolioId: null,
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        connectedAt: null,
        accessTokenExpiresAt: null,
        embeddedSignupAt: null,
        lastWebhookAt: null,
        lastError: null,
      },
      webhook: this.webhookSetup(),
    };
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

  async buildStoreContactLink(companySlug: string, viewer?: JwtPayload) {
    const company = await this.db().company.findFirst({
      where: {
        slug: companySlug,
        isActive: true,
        ...((await this.temporaryTestMode?.publicCompanyVisibilityWhere(viewer)) ?? {}),
      },
    });
    if (!company?.whatsapp) throw new NotFoundException("Empresa não tem WhatsApp configurado.");
    const message = `Olá, ${company.name}! Vim pelo site e gostaria de fazer um pedido.`;
    return { link: this.provider.buildContactLink(company.whatsapp, message) };
  }
}

function channelConfig(channel: any): Record<string, any> {
  return channel?.config && typeof channel.config === "object" && !Array.isArray(channel.config)
    ? channel.config
    : {};
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function brazilianRecipientWithNinthDigit(phone: string) {
  // 55 + DDD (2) + número local de oito dígitos. A variação só é aplicável
  // quando o webhook não trouxe o 9 que identifica celular brasileiro.
  if (!/^55\d{10}$/.test(phone)) return null;
  return `${phone.slice(0, 4)}9${phone.slice(4)}`;
}

function isMetaRecipientNotAllowedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("#131030") || /recipient phone number not in allowed list/i.test(message);
}

function maskPhone(phone: string) {
  if (phone.length <= 4) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

function truncateWhatsappText(value: string) {
  return value.trim().slice(0, MAX_WHATSAPP_TEXT_LENGTH);
}

function mapProviderStatus(status: unknown): WhatsAppMessageStatus {
  switch (String(status).toLowerCase()) {
    case "delivered": return WhatsAppMessageStatus.ENTREGUE;
    case "read": return WhatsAppMessageStatus.LIDA;
    case "failed": return WhatsAppMessageStatus.FALHOU;
    case "sent": return WhatsAppMessageStatus.ENVIADA;
    default: return WhatsAppMessageStatus.ENVIADA;
  }
}

function incomingContent(message: any) {
  const interactive = message?.interactive;
  const reply = interactive?.button_reply ?? interactive?.list_reply;
  if (reply) {
    return { text: String(reply.title ?? reply.id ?? "Opção selecionada"), selectionId: String(reply.id ?? "") };
  }
  if (message?.type === "text") return { text: String(message?.text?.body ?? "").trim() || "Mensagem sem texto", selectionId: "" };
  return { text: `Mensagem recebida: ${String(message?.type ?? "conteúdo não suportado")}.`, selectionId: "" };
}

function selectionFromIncoming(parsed: { text: string; selectionId: string }) {
  const id = parsed.selectionId.toLowerCase();
  if (id === "chegowia:human") return WhatsAppConversationMode.HUMANO;
  if (id === "chegowia:virtual") return WhatsAppConversationMode.VIRTUAL;
  const normalized = parsed.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(humano|atendente|pessoa|equipe)\b/.test(normalized)) return WhatsAppConversationMode.HUMANO;
  if (/\b(virtual|robo|robô|ia)\b/.test(normalized)) return WhatsAppConversationMode.VIRTUAL;
  return null;
}

function personalizedWelcome(value: string | null | undefined, companyName: string) {
  const fallback = `Olá! Você está falando com ${companyName}. Como prefere continuar o atendimento?`;
  return (value?.trim() || fallback).replaceAll("{empresa}", companyName);
}

function publicApiUrl() {
  return (process.env.API_PUBLIC_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isUniqueConstraint(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: string }).code === "P2002";
}
