import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { PrismaModule } from "./common/prisma/prisma.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { TenantInterceptor } from "./common/interceptors/tenant.interceptor";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { CompaniesModule } from "./companies/companies.module";
import { CatalogModule } from "./catalog/catalog.module";
import { EmployeesModule } from "./employees/employees.module";
import { CustomersModule } from "./customers/customers.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { OrdersModule } from "./orders/orders.module";
import { DeliveriesModule } from "./deliveries/deliveries.module";
import { AiModule } from "./ai/ai.module";
import { MessagingModule } from "./messaging/messaging.module";
import { ReportsModule } from "./reports/reports.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    PermissionsModule,
    CompaniesModule,
    CatalogModule,
    EmployeesModule,
    CustomersModule,
    RealtimeModule,
    OrdersModule,
    DeliveriesModule,
    AiModule,
    MessagingModule,
    ReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
