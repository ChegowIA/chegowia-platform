import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { AiService } from "./ai.service";
import { SendMessageDto } from "./dto/send-message.dto";

@ApiTags("ai-motoboy")
@Roles(Role.MOTOBOY)
@Controller("ai/motoboy")
export class AiMotoboyController {
  constructor(private readonly aiService: AiService) {}

  @Post("conversation")
  @RequirePermission(PermissionKey.ENTREGAS_VISUALIZAR)
  startOrGet(@CurrentUser("companyId") companyId: string, @CurrentUser("sub") userId: string) {
    return this.aiService.startOrGetMotoboyConversation(companyId, userId);
  }

  @Get("conversation/:id")
  @RequirePermission(PermissionKey.ENTREGAS_VISUALIZAR)
  detail(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.aiService.getConversationForMotoboy(id, userId);
  }

  @Post("conversation/:id/messages")
  @RequirePermission(PermissionKey.ENTREGAS_VISUALIZAR)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sendMessage(@Param("id") id: string, @CurrentUser("sub") userId: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendMessageAsMotoboy(id, userId, dto.content);
  }
}
