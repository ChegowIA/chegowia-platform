import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { EmployeesController } from "./employees.controller";
import { EmployeesService } from "./employees.service";

@Module({
  imports: [PermissionsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
