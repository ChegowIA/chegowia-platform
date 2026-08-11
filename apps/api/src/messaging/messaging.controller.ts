import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Req, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { PermissionKey } from "@chegowia/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ConnectWhatsAppCloudDto } from "./dto/connect-whatsapp-cloud.dto";
import { ConnectWhatsAppGupshupDto } from "./dto/connect-whatsapp-gupshup.dto";
import { CompleteWhatsAppEmbeddedSignupDto } from "./dto/complete-whatsapp-embedded-signup.dto";
import { SendWhatsAppMessageDto } from "./dto/send-whatsapp-message.dto";
import { UpdateWhatsAppAutomationDto } from "./dto/update-whatsapp-automation.dto";
import { UpdateWhatsAppConversationDto } from "./dto/update-whatsapp-conversation.dto";
import { UpdateWhatsAppProfileDto } from "./dto/update-whatsapp-profile.dto";
import { MessagingService } from "./messaging.service";
import { OptionalJwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";

@ApiTags("messaging")
@Controller("messaging")
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  // A verificação é feita uma vez ao cadastrar o endpoint na Meta. O token nunca
  // é retornado; apenas o challenge assinado/validado é devolvido.
  @Public()
  @SkipThrottle()
  @Get("webhooks/meta")
  verifyMetaWebhook(@Query() query: Record<string, unknown>) {
    return this.messagingService.verifyWebhookChallenge(query);
  }

  @Public()
  @SkipThrottle()
  @Post("webhooks/meta")
  receiveMetaWebhook(
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Req() request: Request & { rawBody?: Buffer },
    @Body() payload: unknown,
  ) {
    if (!request.rawBody || !this.messagingService.verifyWebhookSignature(request.rawBody, signature)) {
      throw new UnauthorizedException("Assinatura do webhook inválida.");
    }
    return this.messagingService.handleMetaWebhook(payload);
  }

  /**
   * Callback v3 do Gupshup. A autenticação é o segredo que a própria plataforma
   * gravou na URL registrada na Partner API — o Gupshup não assina o corpo.
   */
  @Public()
  @SkipThrottle()
  @Post("webhooks/gupshup")
  receiveGupshupWebhook(@Query("token") token: string | undefined, @Body() payload: unknown) {
    if (!this.messagingService.verifyGupshupWebhookToken(token)) {
      throw new UnauthorizedException("Assinatura do webhook inválida.");
    }
    return this.messagingService.handleGupshupWebhook(payload);
  }

  /**
   * Callback do modo self-serve, em formato v2 do Gupshup. Endpoint separado do
   * v3 para não precisar adivinhar o formato pelo corpo — cada modo registra a
   * sua URL no painel/Partner API.
   */
  @Public()
  @SkipThrottle()
  @Post("webhooks/gupshup/self-serve")
  receiveGupshupSelfServeWebhook(@Query("token") token: string | undefined, @Body() payload: unknown) {
    if (!this.messagingService.verifyGupshupWebhookToken(token)) {
      throw new UnauthorizedException("Assinatura do webhook inválida.");
    }
    return this.messagingService.handleGupshupSelfServeWebhook(payload);
  }

  @Roles(Role.ADMIN)
  @Get("channel")
  getChannel(@CurrentUser("companyId") companyId: string) {
    return this.messagingService.getWhatsappChannel(companyId);
  }

  /** O superadmin também consulta: é ele quem precisa da URL de callback. */
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get("channel/whatsapp/gupshup")
  gupshupConfiguration() {
    return this.messagingService.gupshupConfiguration();
  }

  /** Cria o app no BSP e devolve o link oficial de Embedded Signup do Gupshup. */
  @Roles(Role.ADMIN)
  @Post("channel/whatsapp/gupshup/connect")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  startGupshupConnection(@CurrentUser("companyId") companyId: string) {
    return this.messagingService.startGupshupConnection(companyId);
  }

  /** Consultado pelo painel enquanto o empresário conclui o fluxo na Meta. */
  /**
   * Vínculo manual do modo self-serve: o app é criado no painel do Gupshup e o
   * superadmin traz aqui o nome, o id e o link de cadastro do cliente.
   */
  @Roles(Role.ADMIN)
  @Put("channel/whatsapp/gupshup")
  connectGupshupManual(@CurrentUser("companyId") companyId: string, @Body() dto: ConnectWhatsAppGupshupDto) {
    return this.messagingService.connectGupshupManual(companyId, dto);
  }

  /**
   * Mesma operação, na visão do superadmin: é ele quem cria o aplicativo no
   * painel do Gupshup e prepara o número antes de entregar a empresa. O tenant
   * vem da rota porque o superadmin não carrega companyId na sessão.
   */
  @Roles(Role.SUPER_ADMIN)
  @Put("companies/:companyId/whatsapp/gupshup")
  connectGupshupForCompany(@Param("companyId") companyId: string, @Body() dto: ConnectWhatsAppGupshupDto) {
    return this.messagingService.connectGupshupManual(companyId, dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("companies/:companyId/whatsapp")
  getCompanyChannel(@Param("companyId") companyId: string) {
    return this.messagingService.getWhatsappChannel(companyId);
  }

  @Roles(Role.ADMIN)
  @Get("channel/whatsapp/gupshup/status")
  syncGupshupConnection(@CurrentUser("companyId") companyId: string) {
    return this.messagingService.syncGupshupConnection(companyId);
  }

  @Roles(Role.ADMIN)
  @Delete("channel/whatsapp/gupshup")
  disconnectGupshup(@CurrentUser("companyId") companyId: string) {
    return this.messagingService.disconnectGupshupConnection(companyId);
  }

  /**
   * Perfil que o cliente final vê no WhatsApp. Com o número fora do aplicativo,
   * este é o único lugar onde o empresário edita foto, descrição e contatos.
   */
  @Roles(Role.ADMIN)
  @Get("channel/whatsapp/profile")
  getWhatsAppProfile(@CurrentUser("companyId") companyId: string) {
    return this.messagingService.getWhatsAppProfile(companyId);
  }

  @Roles(Role.ADMIN)
  @Patch("channel/whatsapp/profile")
  updateWhatsAppProfile(@CurrentUser("companyId") companyId: string, @Body() dto: UpdateWhatsAppProfileDto) {
    return this.messagingService.updateWhatsAppProfile(companyId, dto);
  }

  @Roles(Role.ADMIN)
  @Post("channel/whatsapp/profile/photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  updateWhatsAppProfilePhoto(@CurrentUser("companyId") companyId: string, @UploadedFile() file: any) {
    // A Meta só aceita JPEG/PNG quadrado no perfil; barrar aqui evita uma ida ao
    // BSP para receber a mesma recusa.
    if (!file?.buffer) {
      throw new BadRequestException("Envie uma imagem para o perfil do WhatsApp.");
    }
    if (!["image/jpeg", "image/png"].includes(String(file.mimetype))) {
      throw new BadRequestException("A foto do perfil precisa ser JPEG ou PNG.");
    }
    return this.messagingService.updateWhatsAppProfilePhoto(companyId, {
      buffer: file.buffer,
      mimeType: String(file.mimetype),
      fileName: String(file.originalname ?? "perfil.jpg"),
    });
  }

  /** Configuração pública do popup; App Secret e token nunca saem do servidor. */
  @Roles(Role.ADMIN)
  @Get("channel/whatsapp/embedded-signup")
  embeddedSignupConfiguration() {
    return this.messagingService.embeddedSignupConfiguration();
  }

  @Roles(Role.ADMIN)
  @Post("channel/whatsapp/embedded-signup")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  completeEmbeddedSignup(
    @CurrentUser("companyId") companyId: string,
    @Body() dto: CompleteWhatsAppEmbeddedSignupDto,
  ) {
    return this.messagingService.completeWhatsAppEmbeddedSignup(companyId, dto);
  }

  /** Compatibilidade para o número usado nos links wa.me existentes. */
  @Roles(Role.ADMIN)
  @Patch("channel/whatsapp")
  setWhatsapp(@CurrentUser("companyId") companyId: string, @Body("number") number: string) {
    return this.messagingService.upsertWhatsappNumber(companyId, number);
  }

  @Roles(Role.ADMIN)
  @Put("channel/whatsapp/cloud")
  connectCloud(@CurrentUser("companyId") companyId: string, @Body() dto: ConnectWhatsAppCloudDto) {
    return this.messagingService.connectWhatsappCloud(companyId, dto);
  }

  @Roles(Role.ADMIN)
  @Patch("channel/whatsapp/automation")
  updateAutomation(@CurrentUser("companyId") companyId: string, @Body() dto: UpdateWhatsAppAutomationDto) {
    return this.messagingService.updateWhatsappAutomation(companyId, dto);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("conversations")
  conversations(@CurrentUser("companyId") companyId: string) {
    return this.messagingService.listWhatsAppConversations(companyId);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("conversations/:id")
  conversation(@CurrentUser("companyId") companyId: string, @Param("id") id: string) {
    return this.messagingService.getWhatsAppConversation(companyId, id);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_EDITAR)
  @Patch("conversations/:id")
  updateConversation(
    @CurrentUser("companyId") companyId: string,
    @Param("id") id: string,
    @Body() dto: UpdateWhatsAppConversationDto,
  ) {
    return this.messagingService.updateWhatsAppConversation(companyId, id, dto);
  }

  /**
   * Limpa somente o histórico visível da conversa do tenant atual. Pedidos já
   * realizados e os lançamentos de consumo continuam preservados.
   */
  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_EDITAR)
  @Delete("conversations/:id/messages")
  clearConversation(
    @CurrentUser("companyId") companyId: string,
    @Param("id") id: string,
  ) {
    return this.messagingService.clearWhatsAppConversation(companyId, id);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_EDITAR)
  @Post("conversations/:id/messages")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  sendHumanMessage(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: SendWhatsAppMessageDto,
  ) {
    return this.messagingService.sendHumanMessage(companyId, userId, id, dto.content);
  }

  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("orders/:orderId/whatsapp-link")
  orderLink(@Param("orderId") orderId: string) {
    return this.messagingService.buildOrderContactLink(orderId);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get("public/:slug/whatsapp-link")
  storeLink(@Param("slug") slug: string, @CurrentUser() viewer?: JwtPayload) {
    return this.messagingService.buildStoreContactLink(slug, viewer);
  }

  @Roles(Role.CLIENTE)
  @Get("my-orders/:orderId/whatsapp-link")
  myOrderLink(@Param("orderId") orderId: string, @CurrentUser("sub") customerId: string) {
    return this.messagingService.buildOrderContactLinkForCustomer(orderId, customerId);
  }
}
