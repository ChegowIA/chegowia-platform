import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { EmployeesController } from "./employees.controller";
import { EmployeesService } from "./employees.service";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [PermissionsModule, AuthModule, RealtimeModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
