import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
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
import { CompleteWhatsAppEmbeddedSignupDto } from "./dto/complete-whatsapp-embedded-signup.dto";
import { SendWhatsAppMessageDto } from "./dto/send-whatsapp-message.dto";
import { UpdateWhatsAppAutomationDto } from "./dto/update-whatsapp-automation.dto";
import { UpdateWhatsAppConversationDto } from "./dto/update-whatsapp-conversation.dto";
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

  @Roles(Role.ADMIN)
  @Get("channel")
  getChannel(@CurrentUser("companyId") companyId: string) {
    return this.messagingService.getWhatsappChannel(companyId);
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
