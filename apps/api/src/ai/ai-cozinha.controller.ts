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
 * Assistente privado da cozinha.
 *
 * Separado do assistente administrativo pelo mesmo motivo dos de motoboy e
 * garçom: a conversa é da pessoa, e o `AiService` reconfere a propriedade
 * antes de ler ou gravar qualquer mensagem.
 *
 * Exige `PEDIDOS_VISUALIZAR` porque é exatamente isso que o assistente expõe —
 * a fila de produção. Sem a permissão, a pessoa não veria esses pedidos no
 * painel, e o assistente não pode ser um caminho alternativo para eles.
 */
@ApiTags("ai-cozinha")
@Roles(Role.COZINHA)
@Controller("ai/cozinha")
export class AiCozinhaController {
  constructor(private readonly aiService: AiService) {}

  @Post("conversation")
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  startOrGet(@CurrentUser("companyId") companyId: string, @CurrentUser("sub") userId: string) {
    return this.aiService.startOrGetKitchenConversation(companyId, userId);
  }

  @Get("conversation/:id")
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  detail(@Param("id") id: string, @CurrentUser("sub") userId: string) {
    return this.aiService.getConversationForKitchen(id, userId);
  }

  @Post("conversation/:id/messages")
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sendMessage(@Param("id") id: string, @CurrentUser("sub") userId: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendMessageAsKitchen(id, userId, dto.content);
  }
}
