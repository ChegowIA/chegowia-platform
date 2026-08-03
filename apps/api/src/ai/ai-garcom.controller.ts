import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { SendMessageDto } from "./dto/send-message.dto";
import { AiService } from "./ai.service";

/**
 * Este controller é propositalmente separado do assistente administrativo.
 * Somente o próprio GARCOM chega a estas rotas; AiService confere novamente a
 * propriedade da conversa antes de ler ou gravar qualquer mensagem.
 */
@ApiTags("ai-garcom")
@Roles(Role.GARCOM)
@Controller("ai/garcom")
export class AiGarcomController {
  constructor(private readonly aiService: AiService) {}

  @Post("conversation")
  @RequirePermission(PermissionKey.MESAS_VISUALIZAR)
  startOrGet(@CurrentUser("companyId") companyId: string, @CurrentUser("sub") userId: string) {
    return this.aiService.startOrGetWaiterConversation(companyId, userId);
  }

  @Get("conversation/:id")
  @RequirePermission(PermissionKey.MESAS_VISUALIZAR)
  detail(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.aiService.getConversationForWaiter(id, userId);
  }

  @Post("conversation/:id/messages")
  @RequirePermission(PermissionKey.MESAS_VISUALIZAR)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sendMessage(@Param("id") id: string, @CurrentUser("sub") userId: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendMessageAsWaiter(id, userId, dto.content);
  }
}
