import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiService } from "./ai.service";
import { StartConversationDto } from "./dto/start-conversation.dto";
import { SendMessageDto } from "./dto/send-message.dto";

@ApiTags("ai")
@Roles(Role.ADMIN, Role.FUNCIONARIO)
@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("conversations")
  start(@CurrentUser("companyId") companyId: string, @CurrentUser("sub") userId: string, @Body() dto: StartConversationDto) {
    return this.aiService.startInternalConversation({
      companyId,
      agentRole: dto.agentRole,
      userId,
      title: dto.title,
    });
  }

  @Get("conversations")
  list(@CurrentUser("companyId") companyId: string) {
    return this.aiService.listInternalConversations(companyId);
  }

  @Get("conversations/:id")
  detail(@Param("id") id: string, @CurrentUser("companyId") companyId: string) {
    return this.aiService.getInternalConversation(id, companyId);
  }

  @Post("conversations/:id/messages")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sendMessage(@Param("id") id: string, @CurrentUser("companyId") companyId: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendMessageAsInternalUser(id, companyId, dto.content);
  }

  @Roles(Role.ADMIN)
  @Post("actions/:id/confirm")
  confirmAction(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.aiService.confirmAction(id, userId);
  }
}
