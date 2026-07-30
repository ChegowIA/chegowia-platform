import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { EmployeesService } from "./employees.service";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { SetPermissionsDto } from "./dto/set-permissions.dto";

@ApiTags("employees")
@Controller("employees")
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @RequirePermission(PermissionKey.FUNCIONARIOS_VISUALIZAR)
  @Get()
  list() {
    return this.employeesService.list();
  }

  @RequirePermission(PermissionKey.FUNCIONARIOS_VISUALIZAR)
  @Get(":id")
  findById(@Param("id") id: string) {
    return this.employeesService.findById(id);
  }

  @RequirePermission(PermissionKey.FUNCIONARIOS_EDITAR)
  @Post()
  create(@CurrentUser("companyId") companyId: string, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(companyId, dto);
  }

  @RequirePermission(PermissionKey.FUNCIONARIOS_EDITAR)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(id, dto);
  }

  @RequirePermission(PermissionKey.FUNCIONARIOS_EDITAR)
  @Patch(":id/permissions")
  setPermissions(@Param("id") id: string, @Body() dto: SetPermissionsDto) {
    return this.employeesService.setPermissions(id, dto.permissionKeys);
  }
}
