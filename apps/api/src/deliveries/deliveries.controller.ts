import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DeliveryStatus, Role } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { DeliveriesService } from "./deliveries.service";
import { AssignMotoboyDto } from "./dto/assign-motoboy.dto";
import { UpdateDeliveryStatusDto } from "./dto/update-delivery-status.dto";
import { UpdateDeliveryLocationDto } from "./dto/update-delivery-location.dto";

@ApiTags("deliveries")
@Controller("deliveries")
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.ENTREGAS_VISUALIZAR)
  @Get()
  list(@Query("status") status?: DeliveryStatus) {
    return this.deliveriesService.listForCompany(status);
  }

  @Roles(Role.MOTOBOY)
  @RequirePermission(PermissionKey.ENTREGAS_VISUALIZAR)
  @Get("me")
  myDeliveries(@CurrentUser("sub") motoboyId: string) {
    return this.deliveriesService.listForMotoboy(motoboyId);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.ENTREGAS_VISUALIZAR)
  @Get(":id")
  findById(@Param("id") id: string) {
    return this.deliveriesService.findById(id);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.ENTREGAS_EDITAR)
  @Patch("order/:orderId/assign")
  assign(@Param("orderId") orderId: string, @Body() dto: AssignMotoboyDto) {
    return this.deliveriesService.assign(orderId, dto.motoboyId);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.ENTREGAS_EDITAR)
  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateDeliveryStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.deliveriesService.updateStatus(id, dto, user.sub, user.role);
  }

  @Roles(Role.MOTOBOY)
  @RequirePermission(PermissionKey.ENTREGAS_EDITAR)
  @Patch("me/location")
  updateMyActiveLocations(
    @Body() dto: UpdateDeliveryLocationDto,
    @CurrentUser("sub") motoboyId: string,
  ) {
    return this.deliveriesService.updateMyActiveLocations(motoboyId, dto);
  }

  @Roles(Role.MOTOBOY)
  @RequirePermission(PermissionKey.ENTREGAS_EDITAR)
  @Patch(":id/location")
  updateLocation(
    @Param("id") id: string,
    @Body() dto: UpdateDeliveryLocationDto,
    @CurrentUser("sub") motoboyId: string,
  ) {
    return this.deliveriesService.updateMotoboyLocation(id, dto, motoboyId);
  }
}
