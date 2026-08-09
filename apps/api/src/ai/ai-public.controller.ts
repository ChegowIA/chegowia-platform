import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalJwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { AiService } from "./ai.service";
import { SendMessageDto } from "./dto/send-message.dto";
import { PublicDiscoveryDto } from "./dto/public-discovery.dto";

/** Agente de Atendimento — usado pelo CLIENTE logado na loja pública da empresa. */
@ApiTags("ai-public")
@Roles(Role.CLIENTE)
@Controller("ai/public/:slug")
export class AiPublicController {
  constructor(private readonly aiService: AiService) {}

  @Post("conversations")
  startOrGet(@Param("slug") slug: string, @CurrentUser("sub") userId: string) {
    return this.aiService.startOrGetCustomerConversation(slug, userId);
  }

  @Get("conversations/:id")
  detail(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.aiService.getConversationForCustomer(id, userId);
  }

  @Post("conversations/:id/messages")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sendMessage(@Param("id") id: string, @CurrentUser("sub") userId: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendMessageAsCustomer(id, userId, dto.content);
  }
}

/** Assistente público de descoberta — consulta apenas catálogo e lojas públicas/ativas. */
@ApiTags("ai-public")
@Public()
@Controller("ai/public-discovery")
@UseGuards(OptionalJwtAuthGuard)
export class AiPublicDiscoveryController {
  constructor(private readonly aiService: AiService) {}

  @Post("search")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  search(@Body() dto: PublicDiscoveryDto, @CurrentUser() viewer?: JwtPayload) {
    return this.aiService.searchPublicCatalog(dto, viewer);
  }
}
