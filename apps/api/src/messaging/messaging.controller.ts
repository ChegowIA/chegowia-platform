import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { MessagingService } from "./messaging.service";

@ApiTags("messaging")
@Controller("messaging")
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Roles(Role.ADMIN)
  @Get("channel")
  getChannel() {
    return this.messagingService.getWhatsappChannel();
  }

  @Roles(Role.ADMIN)
  @Patch("channel/whatsapp")
  setWhatsapp(@CurrentUser("companyId") companyId: string, @Body("number") number: string) {
    return this.messagingService.upsertWhatsappNumber(companyId, number);
  }

  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("orders/:orderId/whatsapp-link")
  orderLink(@Param("orderId") orderId: string) {
    return this.messagingService.buildOrderContactLink(orderId);
  }

  @Public()
  @Get("public/:slug/whatsapp-link")
  storeLink(@Param("slug") slug: string) {
    return this.messagingService.buildStoreContactLink(slug);
  }

  @Roles(Role.CLIENTE)
  @Get("my-orders/:orderId/whatsapp-link")
  myOrderLink(@Param("orderId") orderId: string, @CurrentUser("sub") customerId: string) {
    return this.messagingService.buildOrderContactLinkForCustomer(orderId, customerId);
  }
}
