import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { CustomersService } from "./customers.service";

@ApiTags("customers")
@Controller("customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get()
  list(@Query() query: PaginationQueryDto) {
    return this.customersService.list(query);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM)
  @RequirePermission(PermissionKey.PEDIDOS_VISUALIZAR)
  @Get("inactive")
  listInactive(@Query("days") days = "30") {
    return this.customersService.listInactive(Number(days));
  }
}
