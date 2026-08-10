import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ConnectPlatformWhatsAppCloudDto } from "./dto/connect-platform-whatsapp-cloud.dto";
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
