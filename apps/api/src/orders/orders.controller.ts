import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { OrderStatus, Role } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { OrdersService } from "./orders.service";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get()
  list(@Query() query: PaginationQueryDto, @Query("status") status?: OrderStatus) {
    return this.ordersService.listForCompany({ ...query, status });
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("flow")
  flow(@Query("date") date?: string, @Query("search") search?: string) {
    return this.ordersService.flowForCompany({ date, search });
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("today")
  today() {
    return this.ordersService.today();
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("delayed")
  delayed(@Query("thresholdMinutes") thresholdMinutes?: string) {
    return this.ordersService.delayed(thresholdMinutes ? Number(thresholdMinutes) : undefined);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("pending-count")
  async pendingCount() {
    return { count: await this.ordersService.pendingCount() };
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get(":id")
  findById(@Param("id") id: string) {
    return this.ordersService.findByIdForCompany(id);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_EDITAR)
  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.updateStatus(id, dto.status, user.sub, user.role);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_EDITAR)
  @Patch(":id/payment/paid")
  markPaid(@Param("id") id: string) {
    return this.ordersService.markPaymentPaid(id);
  }
}
