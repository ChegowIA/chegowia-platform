import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ConnectPlatformWhatsAppCloudDto } from "./dto/connect-platform-whatsapp-cloud.dto";
import { ConnectWhatsAppGupshupDto } from "./dto/connect-whatsapp-gupshup.dto";
import { UpdateWhatsAppProfileDto } from "./dto/update-whatsapp-profile.dto";
import { SendWhatsAppMessageDto } from "./dto/send-whatsapp-message.dto";
import { UpdatePlatformWhatsAppAutomationDto } from "./dto/update-platform-whatsapp-automation.dto";
import { UpdatePlatformWhatsAppConversationDto } from "./dto/update-platform-whatsapp-conversation.dto";
import { PlatformWhatsAppService } from "./platform-whatsapp.service";

/**
 * Canal institucional da ChegowIA.
 *
 * As rotas não recebem `companyId` e são exclusivas de SUPER_ADMIN: isso
 * mantém o número comercial da plataforma, seus tokens e suas conversas fora
 * do espaço de qualquer empresa cliente.
 */
@ApiTags("platform-whatsapp")
@Roles(Role.SUPER_ADMIN)
@Controller("platform/whatsapp")
export class PlatformWhatsAppController {
  constructor(private readonly platformWhatsApp: PlatformWhatsAppService) {}

  @Get("channel")
  channel() {
    return this.platformWhatsApp.getChannel();
  }

  @Put("channel")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  connect(@Body() dto: ConnectPlatformWhatsAppCloudDto) {
    return this.platformWhatsApp.connectCloud(dto);
  }

  /** Vínculo manual do modo self-serve do Gupshup para o número institucional. */
  @Put("channel/gupshup")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  connectGupshup(@Body() dto: ConnectWhatsAppGupshupDto) {
    return this.platformWhatsApp.connectGupshupManual(dto);
  }

  /**
   * Perfil que o interessado vê ao abrir a conversa com a ChegowIA. Com o número
   * fora do aplicativo, é por aqui que foto, descrição e contatos são editados.
   */
  @Get("channel/profile")
  profile() {
    return this.platformWhatsApp.getProfile();
  }

  @Patch("channel/profile")
  updateProfile(@Body() dto: UpdateWhatsAppProfileDto) {
    return this.platformWhatsApp.updateProfile(dto);
  }

  @Post("channel/profile/photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  updateProfilePhoto(@UploadedFile() file: any) {
    // A Meta só aceita JPEG/PNG quadrado no perfil; barrar aqui evita uma ida ao
    // BSP para receber a mesma recusa.
    if (!file?.buffer) {
      throw new BadRequestException("Envie uma imagem para o perfil do WhatsApp.");
    }
    if (!["image/jpeg", "image/png"].includes(String(file.mimetype))) {
      throw new BadRequestException("A foto do perfil precisa ser JPEG ou PNG.");
    }
    return this.platformWhatsApp.updateProfilePhoto({
      buffer: file.buffer,
      mimeType: String(file.mimetype),
      fileName: String(file.originalname ?? "perfil.jpg"),
    });
  }

  @Patch("automation")
  updateAutomation(@Body() dto: UpdatePlatformWhatsAppAutomationDto) {
    return this.platformWhatsApp.updateAutomation(dto);
  }

  @Get("conversations")
  conversations() {
    return this.platformWhatsApp.listConversations();
  }

  @Get("conversations/:id")
  conversation(@Param("id") id: string) {
    return this.platformWhatsApp.getConversation(id);
  }

  @Patch("conversations/:id")
  updateConversation(@Param("id") id: string, @Body() dto: UpdatePlatformWhatsAppConversationDto) {
    return this.platformWhatsApp.updateConversation(id, dto);
  }

  @Delete("conversations/:id/messages")
  clearConversation(@Param("id") id: string) {
    return this.platformWhatsApp.clearConversation(id);
  }

  @Post("conversations/:id/messages")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  sendHumanMessage(
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: SendWhatsAppMessageDto,
  ) {
    return this.platformWhatsApp.sendHumanMessage(userId, id, dto.content);
  }
}
