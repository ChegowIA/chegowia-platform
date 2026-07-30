import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { CustomersService } from "./customers.service";

@ApiTags("customers")
@Controller("customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles(Role.ADMIN, Role.FUNCIONARIO)
  @Get()
  list(@Query() query: PaginationQueryDto) {
    return this.customersService.list(query);
  }

  @Roles(Role.ADMIN, Role.FUNCIONARIO)
  @Get("inactive")
  listInactive(@Query("days") days = "30") {
    return this.customersService.listInactive(Number(days));
  }
}
