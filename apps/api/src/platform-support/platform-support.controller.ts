import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { AllowInactiveSubscription } from "../common/decorators/allow-inactive-subscription.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ListPlatformSupportConversationsDto } from "./dto/list-platform-support-conversations.dto";
import { SendPlatformSupportMessageDto } from "./dto/send-platform-support-message.dto";
import { UpdatePlatformSupportConversationDto } from "./dto/update-platform-support-conversation.dto";
import { PlatformSupportService } from "./platform-support.service";

/**
 * Central de suporte autenticado da plataforma.
 *
 * Ela é acessível por qualquer papel logado, inclusive quando a assinatura da
 * empresa venceu. As rotas de administração continuam exclusivas ao
 * SUPER_ADMIN e não recebem companyId em nenhum momento.
 */
@ApiTags("platform-support")
@AllowInactiveSubscription()
@Controller("platform/support")
export class PlatformSupportController {
  constructor(private readonly support: PlatformSupportService) {}

  @Get("conversation")
  mine(@CurrentUser("sub") userId: string) {
    return this.support.getActiveConversationForUser(userId);
  }

  @Post("conversations")
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  start(@CurrentUser("sub") userId: string) {
    return this.support.startOrGetConversationForUser(userId);
  }

  @Post("conversations/:id/messages")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  send(
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: SendPlatformSupportMessageDto,
  ) {
    return this.support.sendUserMessage(userId, id, dto.content);
  }

  @Post("conversations/:id/human")
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  requestHuman(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    return this.support.requestHuman(userId, id);
  }

  @Post("conversations/:id/close")
  closeMine(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    return this.support.closeForUser(userId, id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("admin/conversations")
  listForAdmin(@Query() query: ListPlatformSupportConversationsDto) {
    return this.support.listForAdmin(query);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("admin/conversations/:id")
  adminDetail(@Param("id") id: string) {
    return this.support.getForAdmin(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch("admin/conversations/:id")
  updateForAdmin(
    @CurrentUser("sub") superAdminId: string,
    @Param("id") id: string,
    @Body() dto: UpdatePlatformSupportConversationDto,
  ) {
    return this.support.updateForAdmin(superAdminId, id, dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post("admin/conversations/:id/messages")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  sendAsAdmin(
    @CurrentUser("sub") superAdminId: string,
    @Param("id") id: string,
    @Body() dto: SendPlatformSupportMessageDto,
  ) {
    return this.support.sendSuperAdminMessage(superAdminId, id, dto.content);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete("admin/conversations/:id/messages")
  clear(@Param("id") id: string) {
    return this.support.clearForAdmin(id);
  }
}
