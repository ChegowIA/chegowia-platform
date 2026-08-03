import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role, TableStatus } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { CreateDiningOrderDto } from "./dto/create-dining-order.dto";
import { CreateTableDto } from "./dto/create-table.dto";
import { OpenTableDto } from "./dto/open-table.dto";
import { UpdateDiningOrderStatusDto } from "./dto/update-dining-order-status.dto";
import { TablesService } from "./tables.service";

@ApiTags("tables")
@Controller("tables")
@Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get("overview")
  @RequirePermission(PermissionKey.MESAS_VISUALIZAR)
  overview() {
    return this.tables.overview();
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateTableDto, @CurrentUser() user: JwtPayload) {
    return this.tables.create(dto, user.companyId!);
  }

  @Patch(":id")
  @Roles(Role.ADMIN)
  update(
    @Param("id") id: string,
    @Body() dto: Partial<CreateTableDto> & { status?: TableStatus },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tables.update(id, dto, user.companyId!);
  }

  @Post(":id/open")
  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.MESAS_OPERAR)
  open(@Param("id") id: string, @Body() dto: OpenTableDto, @CurrentUser() user: JwtPayload) {
    return this.tables.open(id, dto, user.sub, user.companyId!);
  }

  @Post(":id/orders")
  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.MESAS_OPERAR)
  addOrder(@Param("id") id: string, @Body() dto: CreateDiningOrderDto, @CurrentUser() user: JwtPayload) {
    return this.tables.addOrder(id, dto, user.sub, user.companyId!);
  }

  @Patch("orders/:orderId/status")
  @RequirePermission(PermissionKey.MESAS_OPERAR)
  updateOrderStatus(
    @Param("orderId") orderId: string,
    @Body() dto: UpdateDiningOrderStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tables.updateOrderStatus(orderId, dto.status, user.companyId!, user.role);
  }

  @Post(":id/close")
  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.MESAS_OPERAR)
  close(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.tables.close(id, user.sub, user.companyId!);
  }
}
