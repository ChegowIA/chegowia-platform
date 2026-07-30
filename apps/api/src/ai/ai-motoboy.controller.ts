import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiService } from "./ai.service";
import { SendMessageDto } from "./dto/send-message.dto";

@ApiTags("ai-motoboy")
@Roles(Role.MOTOBOY)
@Controller("ai/motoboy")
export class AiMotoboyController {
  constructor(private readonly aiService: AiService) {}

  @Post("conversation")
  startOrGet(@CurrentUser("companyId") companyId: string, @CurrentUser("sub") userId: string) {
    return this.aiService.startOrGetMotoboyConversation(companyId, userId);
  }

  @Get("conversation/:id")
  detail(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.aiService.getConversationForMotoboy(id, userId);
  }

  @Post("conversation/:id/messages")
  sendMessage(@Param("id") id: string, @CurrentUser("sub") userId: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendMessageAsMotoboy(id, userId, dto.content);
  }
}
