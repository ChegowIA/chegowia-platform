import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AIChannel, Role } from "@prisma/client";
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
    return this.aiService.startConversation({
      companyId,
      agentRole: dto.agentRole,
      channel: AIChannel.INTERNO,
      userId,
      title: dto.title,
    });
  }

  @Get("conversations")
  list(@Query("channel") channel?: AIChannel) {
    return this.aiService.listConversations(channel);
  }

  @Get("conversations/:id")
  detail(@Param("id") id: string) {
    return this.aiService.getConversation(id);
  }

  @Post("conversations/:id/messages")
  sendMessage(@Param("id") id: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendMessage(id, dto.content);
  }

  @Roles(Role.ADMIN)
  @Post("actions/:id/confirm")
  confirmAction(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.aiService.confirmAction(id, userId);
  }
}
