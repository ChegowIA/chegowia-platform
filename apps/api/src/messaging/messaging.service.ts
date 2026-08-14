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
  WhatsAppProvider,
} from "@prisma/client";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";
import { AiService } from "../ai/ai.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { UsageService } from "../usage/usage.service";
import { ConnectWhatsAppGupshupDto } from "./dto/connect-whatsapp-gupshup.dto";
import { UpdateWhatsAppAutomationDto } from "./dto/update-whatsapp-automation.dto";
import { UpdateWhatsAppProfileDto } from "./dto/update-whatsapp-profile.dto";
import { UpdateWhatsAppConversationDto } from "./dto/update-whatsapp-conversation.dto";
import { MessagingSecretsService } from "./messaging-secrets.service";
import { MailService } from "../common/mail/mail.service";
import { LocalStorageService } from "../common/storage/local-storage.service";
import { formatForWhatsapp } from "./whatsapp-text-format";
import { GupshupWhatsAppProvider } from "./providers/gupshup-whatsapp.provider";
import { MESSAGING_PROVIDER, MessagingProvider } from "./providers/messaging-provider.interface";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { LegacyTestDataService } from "../common/legacy-test-data/legacy-test-data.service";
import { PlatformWhatsAppService } from "./platform-whatsapp.service";


@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
    private readonly gupshup: GupshupWhatsAppProvider,
    private readonly secrets: MessagingSecretsService,
    private readonly mail: MailService,
    private readonly storage: LocalStorageService,
    private readonly ai: AiService,
    private readonly usage: UsageService,
    private readonly realtime: RealtimeGateway,
    private readonly legacyTestData?: LegacyTestDataService,
    private readonly platformWhatsApp?: PlatformWhatsAppService,
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

  // ---------------------------------------------------------------------------
  // Conexão via Gupshup
  // ---------------------------------------------------------------------------

  /** Informa ao painel se o caminho Gupshup está disponível nesta instalação. */
  gupshupConfiguration() {
    const enabled = this.gupshup.isEnabled();
    const selfServe = this.gupshup.mode() === "SELF_SERVE";
    const webhookToken = process.env.GUPSHUP_WEBHOOK_TOKEN?.trim();
    return {
      enabled,
      mode: this.gupshup.mode(),
      // No self-serve o app é criado no painel do Gupshup: o painel mostra o
      // formulário de vínculo manual em vez do botão de conexão automática.
      automaticOnboarding: enabled && this.gupshup.supportsAutomaticOnboarding(),
      /**
       * No self-serve não há API para registrar o callback: o superadmin cola a
       * URL no painel do Gupshup, por aplicativo. O segredo já vem embutido
       * porque é ele que autentica o webhook.
       *
       * São duas portas porque o painel do Gupshup deixa escolher o formato do
       * payload, e cada formato tem um parser diferente. Apontar o formato
       * errado para a porta errada faz o callback chegar e ser descartado em
       * silêncio — por isso as duas são exibidas com o formato ao lado.
       */
      callbackUrls: webhookToken
        ? {
            meta: `${publicApiUrl()}/api/messaging/webhooks/gupshup?token=${encodeURIComponent(webhookToken)}`,
            gupshup: `${publicApiUrl()}/api/messaging/webhooks/gupshup/self-serve?token=${encodeURIComponent(webhookToken)}`,
          }
        : null,
      /** Mantido para o painel antigo; equivale ao formato nativo do Gupshup. */
      callbackUrl: selfServe && webhookToken
        ? `${publicApiUrl()}/api/messaging/webhooks/gupshup/self-serve?token=${encodeURIComponent(webhookToken)}`
        : null,
      reason: enabled ? null : "A conexão pelo Gupshup ainda não está habilitada nesta plataforma.",
    };
  }

  /**
   * Abre a conexão de um número. Criamos o app no Gupshup, apontamos o callback
   * para a nossa API e devolvemos o link oficial de Embedded Signup — quem
   * responde à Meta pelo aplicativo é o Gupshup, então a plataforma não depende
   * do App Review próprio para colocar um cliente no ar.
   *
   * O canal nasce INATIVO: só vira ATIVO quando a Meta promove o número a "live",
   * o que é confirmado em `syncGupshupConnection`.
   */
  async startGupshupConnection(companyId: string) {
    if (!this.gupshup.isEnabled()) {
      throw new BadRequestException("A conexão pelo Gupshup ainda não está habilitada nesta plataforma.");
    }
    if (!this.secrets.isConfigured()) {
      throw new BadRequestException("Configure a chave de criptografia de credenciais antes de conectar um número.");
    }

    const existing = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    // Reaproveita o app quando o empresário reabre o assistente no meio do
    // caminho; criar outro deixaria um app órfão consumindo cota do parceiro.
    let appId = existing?.provider === WhatsAppProvider.GUPSHUP ? existing.gupshupAppId : null;
    let appName = existing?.gupshupAppName ?? null;
    if (!appId) {
      const company = await this.db().company.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundException("Empresa não encontrada.");
      const created = await this.gupshup.createApp({ name: gupshupAppName(company) });
      appId = created.appId;
      appName = created.name;
    }

    const webhookToken = process.env.GUPSHUP_WEBHOOK_TOKEN?.trim();
    if (!webhookToken) {
      throw new BadRequestException("Configure GUPSHUP_WEBHOOK_TOKEN antes de conectar números pelo Gupshup.");
    }
    // O segredo viaja na URL registrada no BSP: é o que autentica o callback,
    // já que o Gupshup não assina o corpo como a Meta.
    await this.gupshup.setCallbackUrl(
      appId,
      `${publicApiUrl()}/api/messaging/webhooks/gupshup?token=${encodeURIComponent(webhookToken)}`,
    );
    const embedLink = await this.gupshup.generateEmbedLink(appId);

    const channel = await this.db().messagingChannel.upsert({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
      create: {
        companyId,
        type: MessagingChannelType.WHATSAPP,
        provider: WhatsAppProvider.GUPSHUP,
        status: MessagingChannelStatus.INATIVO,
        config: {},
        gupshupAppId: appId,
        gupshupAppName: appName,
      },
      update: {
        provider: WhatsAppProvider.GUPSHUP,
        gupshupAppId: appId,
        gupshupAppName: appName,
        lastError: null,
      },
    });

    return { ...this.channelSummary(channel), embedLink };
  }

  /**
   * Registra o pedido de WhatsApp do empresário.
   *
   * No self-serve o aplicativo é criado à mão no painel do Gupshup, então o que
   * este botão faz é sinalizar ao superadmin que há trabalho esperando. Repetir o
   * pedido não cria fila nem reinicia nada: mantemos a primeira data, que é a
   * que importa para saber há quanto tempo a empresa espera.
   */
  async requestWhatsappAccess(companyId: string) {
    const current = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    const channel = await this.db().messagingChannel.upsert({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
      create: {
        companyId,
        type: MessagingChannelType.WHATSAPP,
        provider: WhatsAppProvider.GUPSHUP,
        status: MessagingChannelStatus.INATIVO,
        config: {},
        accessRequestedAt: new Date(),
      },
      update: {
        accessRequestedAt: current?.accessRequestedAt ?? new Date(),
      },
    });
    // Só notifica no primeiro pedido: reclicar o botão não deve gerar e-mail
    // novo, senão o aviso perde valor justamente quando o cliente está ansioso.
    if (!current?.accessRequestedAt) {
      await this.notifyWhatsappAccessRequest(companyId);
    }
    return this.channelSummary(channel);
  }

  /**
   * Avisa a equipe pelos dois caminhos: tempo real, para quem está com o painel
   * aberto, e e-mail, porque o pedido pode chegar fora do horário e o trabalho
   * manual do self-serve não acontece sozinho.
   *
   * Falha de notificação nunca derruba o pedido: para o empresário o pedido foi
   * registrado, e é o registro que importa.
   */
  private async notifyWhatsappAccessRequest(companyId: string) {
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      select: { name: true, slug: true, city: true, state: true },
    });
    const name = company?.name ?? companyId;

    try {
      this.realtime.emitToSuperAdmins("whatsapp.access.requested", { companyId, companyName: name });
    } catch (error) {
      this.logger.warn(`Falha ao emitir aviso em tempo real do pedido de WhatsApp de ${name}.`);
    }

    try {
      await this.mail.sendOperationsAlert("Pedido de acesso ao WhatsApp", [
        `A empresa ${name} solicitou o WhatsApp pela plataforma.`,
        company?.city ? `Cidade: ${company.city}/${company.state ?? "--"}` : "",
        "",
        "Próximo passo: crie o aplicativo no painel do Gupshup, cole a URL de callback e traga o nome, o App ID e o link de cadastro para a página da empresa no super-admin.",
        `${publicAppUrl()}/super-admin/empresas/${companyId}`,
      ].filter(Boolean));
    } catch (error) {
      // O e-mail é conveniência; o pedido já está no banco e visível no painel.
      this.logger.error(
        `Falha ao enviar e-mail do pedido de WhatsApp de ${name}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    this.logger.warn(`Empresa ${name} (${companyId}) solicitou acesso ao WhatsApp.`);
  }

  /**
   * Vincula um app do Gupshup criado à mão no painel deles. É o caminho do modo
   * self-serve: sem Partner API não há como criar o app por código, mas o resto
   * do sistema (envio, webhook, perfil) funciona igual.
   *
   * O canal nasce INATIVO quando ainda não há número: o webhook do Gupshup ou o
   * preenchimento posterior do número é que o ativam.
   */
  async connectGupshupManual(companyId: string, dto: ConnectWhatsAppGupshupDto) {
    if (!this.gupshup.isEnabled()) {
      throw new BadRequestException("A conexão pelo Gupshup ainda não está habilitada nesta plataforma.");
    }
    const appName = dto.appName.trim();
    const number = dto.number ? normalizePhone(dto.number) : null;
    if (number && number.length < 10) {
      throw new BadRequestException("Informe o número do WhatsApp com DDI e DDD.");
    }

    // O nome do app é único global, como o phone number id da Meta: é por ele
    // que o callback v2 encontra o canal, então dois tenants não podem repetir.
    const owner = await tenantContext.run({ companyId: null, bypass: true }, () => {
      return this.db().messagingChannel.findUnique({ where: { gupshupAppName: appName } });
    });
    if (owner && owner.companyId !== companyId) {
      throw new ConflictException("Este aplicativo do Gupshup já está vinculado a outra empresa.");
    }

    const current = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    const config = {
      ...channelConfig(current),
      ...(number ? { number } : {}),
      ...(dto.signupLink ? { gupshupSignupLink: dto.signupLink.trim() } : {}),
    };
    const data = {
      provider: WhatsAppProvider.GUPSHUP,
      status: number ? MessagingChannelStatus.ATIVO : MessagingChannelStatus.INATIVO,
      config,
      gupshupAppName: appName,
      gupshupAppId: dto.appId?.trim() || null,
      ...(number ? { connectedAt: new Date() } : {}),
      lastError: null,
    };

    try {
      const channel = await this.db().messagingChannel.upsert({
        where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
        create: { companyId, type: MessagingChannelType.WHATSAPP, ...data },
        update: data,
      });
      if (number) {
        await this.db().company.updateMany({
          where: { id: companyId, whatsapp: null },
          data: { whatsapp: number },
        });
      }
      return this.channelSummary(channel);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException("Este aplicativo do Gupshup já está vinculado a outra empresa.");
      }
      throw error;
    }
  }

  /**
   * Confere na Partner API se o número já concluiu o Embedded Signup. É o que o
   * painel consulta enquanto o empresário termina o fluxo na janela da Meta.
   */
  async syncGupshupConnection(companyId: string) {
    const channel = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    if (!channel || channel.provider !== WhatsAppProvider.GUPSHUP || !channel.gupshupAppId) {
      throw new NotFoundException("Nenhuma conexão do Gupshup foi iniciada para esta empresa.");
    }

    const details = await this.gupshup.getAppDetails(channel.gupshupAppId);
    const phone = details.phone ? normalizePhone(details.phone) : null;
    // "live" é o sinal do Gupshup de que a Meta liberou o número; sem ele o app
    // existe mas ainda não envia.
    const ready = details.live === true && Boolean(phone);

    const updated = await this.db().messagingChannel.update({
      where: { id: channel.id },
      data: {
        status: ready ? MessagingChannelStatus.ATIVO : MessagingChannelStatus.INATIVO,
        gupshupAppName: details.name ?? channel.gupshupAppName,
        ...(phone ? { config: { ...channelConfig(channel), number: phone } } : {}),
        ...(ready && !channel.connectedAt ? { connectedAt: new Date() } : {}),
      },
    });

    if (ready && phone) {
      await this.db().company.updateMany({
        where: { id: companyId, whatsapp: null },
        data: { whatsapp: phone },
      });
    }
    return this.channelSummary(updated);
  }

  /**
   * Solta o número deste tenant. Não removemos o app no Gupshup: ele pode estar
   * em migração e apagar aqui não desfaz o vínculo na Meta — quem decide isso é
   * o dono do número no portal do BSP.
   */
  async disconnectGupshupConnection(companyId: string) {
    const channel = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    if (!channel || channel.provider !== WhatsAppProvider.GUPSHUP) {
      throw new NotFoundException("Nenhuma conexão do Gupshup foi iniciada para esta empresa.");
    }
    const updated = await this.db().messagingChannel.update({
      where: { id: channel.id },
      data: {
        status: MessagingChannelStatus.INATIVO,
        gupshupAppId: null,
        gupshupAppName: null,
        gupshupAppTokenEncrypted: null,
        gupshupAppTokenExpiresAt: null,
        connectedAt: null,
      },
    });
    return this.channelSummary(updated);
  }

  // ---------------------------------------------------------------------------
  // Perfil comercial do WhatsApp
  // ---------------------------------------------------------------------------

  /**
   * Lê o perfil que o cliente final vê no WhatsApp. Como o número deixa de estar
   * no aplicativo, este painel passa a ser o único lugar onde o empresário
   * consegue editar foto, descrição e contatos.
   */
  async getWhatsAppProfile(companyId: string) {
    const { channel, appToken } = await this.gupshupChannelWithToken(companyId);
    const [profile, photoUrl] = await Promise.all([
      this.gupshup.getBusinessProfile({ appId: channel.gupshupAppId, appToken }),
      this.gupshup.getProfilePhotoUrl({ appId: channel.gupshupAppId, appToken }).catch(() => null),
    ]);
    return {
      ...profile,
      // A API nem sempre devolve a foto — em conta nova costuma vir vazia mesmo
      // depois de um upload aceito. Guardamos uma cópia no envio para o painel
      // não parecer que a imagem se perdeu; quando o provedor responde, a
      // resposta dele manda, porque é o que o cliente realmente vê.
      profilePictureUrl: photoUrl ?? channelConfig(channel).profilePhotoUrl ?? null,
      displayName: channel.gupshupAppName ?? null,
      number: channelConfig(channel).number ?? null,
    };
  }

  async updateWhatsAppProfile(companyId: string, dto: UpdateWhatsAppProfileDto) {
    const { channel, appToken } = await this.gupshupChannelWithToken(companyId);
    const changed = Object.values(dto).some((value) => value !== undefined && value !== null && value !== "");
    // Nada preenchido: evita uma ida ao BSP que não muda nada e cujo erro
    // apareceria como se a gravação tivesse falhado.
    if (!changed) return this.getWhatsAppProfile(companyId);

    await this.gupshup.updateBusinessProfile({
      appId: channel.gupshupAppId,
      appToken,
      profile: dto,
    });
    // A gravação já aconteceu. Se a releitura falhar, devolver erro faria o
    // empresário achar que perdeu a edição e tentar de novo.
    return this.getWhatsAppProfile(companyId).catch(() => ({ ...dto, savedButNotReloaded: true }));
  }

  async updateWhatsAppProfilePhoto(
    companyId: string,
    file: { buffer: Buffer; mimeType: string; fileName: string },
  ) {
    const { channel, appToken } = await this.gupshupChannelWithToken(companyId);
    await this.gupshup.updateProfilePhoto({ appId: channel.gupshupAppId, appToken, file });

    // Só guardamos depois que o provedor aceitou: uma cópia local de imagem
    // recusada mostraria no painel algo que o cliente nunca veria.
    const storedUrl = await this.storage.savePublicImage(file, "companies", `whatsapp-${companyId}`);
    const previousUrl = channelConfig(channel).profilePhotoUrl;
    await this.db().messagingChannel.update({
      where: { id: channel.id },
      data: { config: { ...channelConfig(channel), profilePhotoUrl: storedUrl } },
    });
    if (typeof previousUrl === "string") await this.storage.removePublicUrl(previousUrl);

    return this.getWhatsAppProfile(companyId);
  }

  /**
   * O perfil só existe quando o número está de fato no ar por um BSP que o
   * gerencie. Hoje isso é o Gupshup; canais Meta continuam editando o perfil
   * pelo Business Manager, que é onde a credencial deles vive.
   */
  private async gupshupChannelWithToken(companyId: string) {
    const channel = await this.db().messagingChannel.findUnique({
      where: { companyId_type: { companyId, type: MessagingChannelType.WHATSAPP } },
    });
    if (!channel || channel.provider !== WhatsAppProvider.GUPSHUP || !channel.gupshupAppId) {
      throw new BadRequestException(
        "O perfil do WhatsApp só pode ser editado aqui quando o número está conectado pelo Gupshup.",
      );
    }
    const appToken = await this.gupshupAppTokenFor(channel);
    return { channel, appToken };
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
    const token = process.env.GUPSHUP_WEBHOOK_TOKEN?.trim();
    return {
      url: `${publicApiUrl()}/api/messaging/webhooks/gupshup`,
      // O Gupshup não assina o corpo: o segredo na URL é a prova de origem.
      tokenConfigured: Boolean(token),
      encryptionConfigured: this.secrets.isConfigured(),
    };
  }

  /**
   * O Gupshup não assina o callback como a Meta faz com x-hub-signature-256.
   * Autenticamos pelo segredo que nós mesmos colocamos na URL registrada na
   * Partner API: só a plataforma e o Gupshup a conhecem.
   */
  verifyGupshupWebhookToken(token?: string) {
    const expected = process.env.GUPSHUP_WEBHOOK_TOKEN?.trim();
    if (!expected || !token) return false;
    return safeEqual(token, expected);
  }

  /**
   * Callback do gupshup.io no modo self-serve. Aqui o formato é o v2 proprietário
   * do Gupshup, não o envelope da Meta — convertemos para o formato Meta e
   * seguimos pelo mesmo caminho de tratamento, para não manter dois parsers de
   * conversa.
   *
   * O canal é resolvido pelo nome do app (`app`), que é o identificador que o
   * Gupshup envia no v2 e é único na plataforma deles.
   */
  /**
   * Porta única do Gupshup. O painel deles deixa escolher o formato do payload
   * por webhook, e escolher errado fazia a mensagem ser aceita e descartada em
   * silêncio. Em vez de exigir que a URL combine com o dropdown, reconhecemos o
   * formato pelo próprio corpo — assim qualquer combinação funciona.
   */
  async handleGupshupWebhookAnyFormat(payload: any) {
    if (isMetaFormatCallback(payload)) return this.handleGupshupWebhook(payload);
    if (typeof payload?.app === "string") return this.handleGupshupSelfServeWebhook(payload);

    // Nem um nem outro: registrar as chaves do topo é o que permite descobrir um
    // formato novo sem precisar reproduzir o problema.
    this.logger.warn(
      `Callback Gupshup em formato não reconhecido. Chaves recebidas: ${Object.keys(payload ?? {}).join(", ") || "nenhuma"}.`,
    );
    return { ignored: true };
  }

  async handleGupshupSelfServeWebhook(payload: any) {
    const appName = typeof payload?.app === "string" ? payload.app : null;
    if (!appName) return { ignored: true };

    const channel = await tenantContext.run({ companyId: null, bypass: true }, () => {
      return this.db().messagingChannel.findUnique({
        where: { gupshupAppName: appName },
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
    });
    const value = metaValueFromGupshupV2(payload);
    // No formato v2 o billing-event vem fora do envelope de mensagem. Ele é
    // importante porque traz `deductions.type` e `billable` confirmados pelo
    // próprio Gupshup; não o convertemos para uma mensagem fictícia.
    const billingEvent = payload?.type === "billing-event" && payload?.payload
      ? payload
      : null;
    if (!value && !billingEvent) return { ignored: true };

    if (!channel) {
      // Pode ser o número institucional da ChegowIA, que vive em tabelas
      // próprias justamente para não atravessar o isolamento dos tenants.
      const handledByPlatform = value && this.platformWhatsApp
        ? await this.platformWhatsApp.handleGupshupMessagesChange(appName, value)
        : false;
      if (handledByPlatform) return { received: true };
      this.logger.warn(`Callback Gupshup ignorado: aplicativo não vinculado (${appName}).`);
      return { ignored: true };
    }

    await tenantContext.run({ companyId: channel.companyId, bypass: false }, async () => {
      if (value) await this.processMessagesChangeForChannel(channel, value, appName);
      if (billingEvent) await this.processGupshupBillingEvent(channel, billingEvent);
    });
    return { received: true };
  }

  /**
   * Callback v3 do Gupshup: mesmo envelope da Meta, acrescido de `gs_app_id`.
   * É por esse id que o canal é resolvido, já que o número da Meta não é
   * gerenciado por nós neste caminho.
   */
  async handleGupshupWebhook(payload: any) {
    const appId = readGupshupAppId(payload);
    if (!appId) return { ignored: true };

    // O app id é único global, como o phone number id da Meta. O bypass existe
    // só para achar o dono do callback; nenhum dado do tenant sai daqui.
    const channel = await tenantContext.run({ companyId: null, bypass: true }, () => {
      return this.db().messagingChannel.findUnique({
        where: { gupshupAppId: appId },
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
    });
    const changes: any[] = [];
    const billingEvents: any[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field === "messages") changes.push(change.value ?? {});
        // O evento de billing v3 é a confirmação mais precisa de tarifa do
        // Gupshup/Meta. Alguns apps o habilitam separadamente, por isso o
        // status continua como fallback quando ele não vier.
        if (change?.field === "billing-event") billingEvents.push(change.value ?? {});
      }
    }

    if (!channel) {
      // Pode ser o número institucional da ChegowIA, que vive em tabelas
      // próprias justamente para não atravessar o isolamento dos tenants.
      let handledByPlatform = false;
      for (const value of changes) {
        if (!this.platformWhatsApp) break;
        handledByPlatform = await this.platformWhatsApp.handleGupshupMessagesChangeByAppId(appId, value)
          || handledByPlatform;
      }
      if (handledByPlatform) return { received: true };
      this.logger.warn(`Callback Gupshup ignorado: aplicativo não vinculado (${appId}).`);
      return { ignored: true };
    }

    for (const value of changes) {
      await tenantContext.run({ companyId: channel.companyId, bypass: false }, () => {
        return this.processMessagesChangeForChannel(channel, value, appId);
      });
    }
    for (const value of billingEvents) {
      await tenantContext.run({ companyId: channel.companyId, bypass: false }, () => {
        return this.processGupshupBillingEvent(channel, value);
      });
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
            automationEnabled: true,
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

  /**
   * Trecho comum aos dois BSPs. O `value` chega no formato da Meta tanto pelo
   * webhook oficial quanto pelo callback v3 do Gupshup, então só a resolução do
   * canal difere — aqui para baixo o tratamento é idêntico.
   */
  private async processMessagesChangeForChannel(channel: any, value: any, reference: string) {
    if (channel.status !== MessagingChannelStatus.ATIVO) {
      this.logger.warn(`Webhook WhatsApp ignorado: canal inativo (${reference}).`);
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
    if (!existing) {
      // Uma falha que não conseguimos atribuir é a pior de diagnosticar: a
      // mensagem fica "enviada" no painel e o motivo do WhatsApp se perde.
      if (mapProviderStatus(status?.status) === WhatsAppMessageStatus.FALHOU) {
        this.logger.warn(
          `Falha de entrega sem mensagem correspondente (${providerMessageId}): ${JSON.stringify(status?.errors ?? status?.status)}`,
        );
      }
      return;
    }
    const mappedStatus = mapProviderStatus(status?.status);
    const pricingCategory = status?.pricing?.category ? String(status.pricing.category) : undefined;
    const error = status?.errors?.[0];
    const usage = existing.direction === WhatsAppMessageDirection.ENVIADA
      ? await this.usage.repriceWhatsAppUsage({
          companyId: existing.companyId,
          channelId: existing.channelId,
          providerMessageId,
          pricingCategory,
          billable: providerReportedBillable(status?.pricing?.billable),
          deliveryConfirmed: mappedStatus === WhatsAppMessageStatus.FALHOU
            ? false
            : mappedStatus === WhatsAppMessageStatus.ENTREGUE || mappedStatus === WhatsAppMessageStatus.LIDA
              ? true
              : undefined,
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

    // O Gupshup self-serve cobra as mensagens de sessão em texto (inclusive
    // respostas interativas), mas mídia é gratuita. Registrar no mesmo razão
    // da empresa mantém a fatura auditável e impede estimativa no frontend.
    const usage = isBillableGupshupIncomingMessage(message)
      ? await this.usage.recordWhatsAppUsage({
          companyId: channel.companyId,
          channelId: channel.id,
          providerMessageId,
          pricingCategory: "service",
        })
      : null;
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
          pricingCategory: usage ? "service" : null,
          providerCost: usage?.providerAmount ?? 0,
          billableAmount: usage?.billableAmount ?? 0,
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

  /**
   * Reconciliador do callback `billing-event` v3. Não confiamos em valor vindo
   * no webhook: a tarifa é sempre a versão ativa de UsageRate, mas a categoria
   * e a isenção confirmadas pelo BSP definem qual tarifa deve ser aplicada.
   */
  private async processGupshupBillingEvent(channel: any, value: any) {
    const root = value?.type === "billing-event" && value?.payload && typeof value.payload === "object"
      ? value.payload
      : value;
    const billing = root?.billing && typeof root.billing === "object" ? root.billing : root;
    const deductions = billing?.deductions && typeof billing.deductions === "object" ? billing.deductions : billing;
    const references = billing?.references && typeof billing.references === "object" ? billing.references : {};
    const providerMessageId = firstString(
      references.id,
      references.message_id,
      references.messageId,
      billing?.message_id,
      billing?.messageId,
      billing?.id,
    );
    if (!providerMessageId) return;
    const message = await this.db().whatsAppMessage.findUnique({ where: { providerMessageId } });
    if (!message || message.companyId !== channel.companyId || message.direction !== WhatsAppMessageDirection.ENVIADA) return;
    const pricingCategory = firstString(deductions?.category, deductions?.type, billing?.category, billing?.type);
    const billable = providerReportedBillable(deductions?.billable ?? billing?.billable);
    const usage = await this.usage.repriceWhatsAppUsage({
      companyId: message.companyId,
      channelId: message.channelId,
      providerMessageId,
      pricingCategory,
      billable,
      deliveryConfirmed: true,
    });
    await this.db().whatsAppMessage.update({
      where: { id: message.id },
      data: {
        pricingCategory: pricingCategory ?? undefined,
        providerCost: usage?.providerAmount ?? undefined,
        billableAmount: usage?.billableAmount ?? undefined,
      },
    });
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
    const dispatch = await this.dispatcherFor(channel);
    try {
      const sent = await this.sendToMetaRecipient(
        conversation.customerPhone,
        (to) => dispatch.choiceMenu(to, truncateWhatsappText(body)),
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
    const dispatch = await this.dispatcherFor(channel);
    try {
      const sent = await this.sendToMetaRecipient(
        conversation.customerPhone,
        (to) => dispatch.text(to, body),
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

  /** Credenciais e identidade de origem para o envio pelo Gupshup. */
  private async dispatcherFor(channel: any) {
    const params = {
      appId: channel.gupshupAppId ?? "",
      appToken: await this.gupshupAppTokenFor(channel),
      source: channelConfig(channel).number ?? null,
      appName: channel.gupshupAppName ?? null,
    };
    return {
      text: (to: string, body: string) => this.gupshup.sendText({ ...params, to, body }),
      choiceMenu: (to: string, body: string) => this.gupshup.sendChoiceMenu({ ...params, to, body }),
    };
  }

  /**
   * O token de app do Gupshup vale 24h. Reaproveitamos o que está cifrado no
   * canal enquanto for válido e renovamos pela Partner API quando vence,
   * persistindo o novo — assim uma mensagem nunca falha por credencial expirada
   * e não pagamos uma ida à Partner API por envio.
   */
  private async gupshupAppTokenFor(channel: any): Promise<string> {
    if (channel.status !== MessagingChannelStatus.ATIVO) {
      throw new BadRequestException("Este canal não está conectado ao WhatsApp pelo Gupshup.");
    }
    // No self-serve a autenticação é a apikey da conta, resolvida no provider;
    // não existe token por app para buscar nem guardar.
    if (this.gupshup.mode() === "SELF_SERVE") return "";
    if (!channel.gupshupAppId) {
      throw new BadRequestException("Este canal não está conectado ao WhatsApp pelo Gupshup.");
    }
    const stored = channel.gupshupAppTokenEncrypted;
    const expiresAt = channel.gupshupAppTokenExpiresAt as Date | null;
    if (stored && expiresAt && expiresAt.getTime() > Date.now()) {
      return this.secrets.decrypt(stored);
    }
    const renewed = await this.gupshup.fetchAppToken(channel.gupshupAppId);
    await this.db().messagingChannel.update({
      where: { id: channel.id },
      data: {
        gupshupAppTokenEncrypted: this.secrets.encrypt(renewed.token),
        gupshupAppTokenExpiresAt: renewed.expiresAt,
      },
    });
    // Mantém o objeto em memória coerente com o banco: o mesmo canal costuma ser
    // reusado adiante no fluxo de envio.
    channel.gupshupAppTokenEncrypted = this.secrets.encrypt(renewed.token);
    channel.gupshupAppTokenExpiresAt = renewed.expiresAt;
    return renewed.token;
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
      number: config.number ?? null,
      automationEnabled: Boolean(channel.automationEnabled),
      welcomeMessage: channel.welcomeMessage ?? null,
      // O canal está de pé quando existe aplicativo vinculado e ele foi ativado.
      connected: Boolean(channel.gupshupAppId && channel.status === MessagingChannelStatus.ATIVO),
      gupshup: {
        appId: channel.gupshupAppId ?? null,
        appName: channel.gupshupAppName ?? null,
        accessRequestedAt: channel.accessRequestedAt ?? null,
        // Link que o empresário abre para concluir o cadastro com o Facebook
        // dele. No self-serve vem colado pelo superadmin; no partner é gerado.
        signupLink: config.gupshupSignupLink ?? null,
      },
      integration: {
        connectedAt: channel.connectedAt ?? null,
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
      gupshup: { appId: null, appName: null, signupLink: null, accessRequestedAt: null },
      integration: {
        connectedAt: null,
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
        ...(this.legacyTestData?.publicCompanyVisibilityWhere(viewer) ?? { isTestOnly: false }),
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

/**
 * Traduz o callback v2 do Gupshup para o `value` que a Meta envia, de forma que
 * `processIncomingMessage`/`processMessageStatus` continuem sendo os únicos
 * lugares que entendem uma conversa.
 *
 * Devolve null para eventos que não representam mensagem nem status (por exemplo
 * os avisos de conta), que devem ser descartados sem log de erro.
 */
function metaValueFromGupshupV2(payload: any): any | null {
  const inner = payload?.payload;
  if (!inner) return null;

  if (payload.type === "message-event") {
    /**
     * `id` é o mesmo identificador que a resposta de envio devolve em
     * `messageId`, e é o que gravamos na mensagem. `gsId` é interno do Gupshup e
     * não casa com nada nosso — preferi-lo fazia todo evento de status ser
     * descartado por não encontrar a mensagem, deixando tudo "enviada" para
     * sempre e engolindo o motivo real da falha.
     */
    const providerMessageId = inner.id ?? inner.gsId;
    if (!providerMessageId) return null;
    return {
      messaging_product: "whatsapp",
      metadata: {},
      statuses: [
        {
          id: String(providerMessageId),
          status: String(inner.type ?? ""),
          recipient_id: inner.destination ? String(inner.destination) : undefined,
          errors: inner.payload?.reason ? [{ message: String(inner.payload.reason) }] : undefined,
        },
      ],
    };
  }

  if (payload.type !== "message") return null;

  const sender = inner.sender ?? {};
  const from = String(inner.source ?? sender.phone ?? "");
  if (!from) return null;
  // O v2 traz timestamp em milissegundos; a Meta usa segundos.
  const timestamp = Math.floor(Number(payload.timestamp ?? Date.now()) / 1000);
  const base = { from, id: String(inner.id ?? ""), timestamp: String(timestamp) };

  let message: Record<string, unknown>;
  if (inner.type === "button_reply" || inner.type === "list_reply" || inner.type === "quick_reply") {
    const replyKey = inner.type === "list_reply" ? "list_reply" : "button_reply";
    message = {
      ...base,
      type: "interactive",
      interactive: {
        type: replyKey,
        [replyKey]: {
          // No quick reply o Gupshup devolve o postbackText que enviamos como id.
          id: String(inner.payload?.postbackText ?? inner.payload?.id ?? ""),
          title: String(inner.payload?.title ?? inner.payload?.text ?? ""),
        },
      },
    };
  } else if (inner.type === "text") {
    message = { ...base, type: "text", text: { body: String(inner.payload?.text ?? "") } };
  } else {
    // Mídia e demais tipos caem no texto genérico já tratado por incomingContent.
    message = { ...base, type: String(inner.type ?? "unsupported") };
  }

  return {
    messaging_product: "whatsapp",
    metadata: {},
    contacts: [{ profile: { name: sender.name ? String(sender.name) : undefined }, wa_id: from }],
    messages: [message],
  };
}

/**
 * Distingue o envelope no formato Meta (v3) do formato nativo do Gupshup (v2).
 * O v3 carrega `entry`/`changes` — estrutura que o v2 não tem — enquanto o v2 se
 * identifica por `app` mais `payload`.
 */
function isMetaFormatCallback(payload: any) {
  if (payload?.object === "whatsapp_business_account") return true;
  return Array.isArray(payload?.entry);
}

/**
 * O `gs_app_id` aparece na raiz do envelope v3, mas o Gupshup também o repete
 * dentro de entry/changes conforme o evento. Procuramos nos dois lugares para
 * não descartar callback válido.
 */
function readGupshupAppId(payload: any): string | null {
  const direct = payload?.gs_app_id ?? payload?.app;
  if (typeof direct === "string" && direct) return direct;
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const nested = change?.value?.gs_app_id;
      if (typeof nested === "string" && nested) return nested;
    }
  }
  return null;
}

/**
 * O Gupshup exige nome de app único e sem espaço/acento. Prefixamos com a
 * plataforma e fechamos com o id da empresa para não colidir entre tenants nem
 * vazar o nome fantasia do cliente no painel do parceiro.
 */
function gupshupAppName(company: { id: string; slug?: string | null }) {
  const base = (company.slug ?? "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 20) || "empresa";
  return `chegowia${base}${company.id.slice(-8)}`;
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

/**
 * Ponto único por onde todo texto de saída passa. Além de cortar no limite do
 * WhatsApp, converte o Markdown que o modelo produz para a formatação que o
 * aplicativo entende — ver whatsapp-text-format.ts.
 */
function truncateWhatsappText(value: string) {
  return formatForWhatsapp(value);
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

/** Mensagens de mídia não têm tarifa de sessão no plano self-serve do Gupshup. */
function isBillableGupshupIncomingMessage(message: any) {
  switch (String(message?.type ?? "").toLowerCase()) {
    case "text":
    case "interactive":
    case "button":
    case "list":
    case "quick_reply":
      return true;
    default:
      return false;
  }
}

function providerReportedBillable(value: unknown): boolean | undefined {
  if (value === false || String(value).toLowerCase() === "false") return false;
  if (value === true || String(value).toLowerCase() === "true") return true;
  return undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
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

/** Endereço do painel, para o aviso levar direto à página onde há trabalho. */
function publicAppUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
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
