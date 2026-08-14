import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./common/prisma/prisma.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { TenantInterceptor } from "./common/interceptors/tenant.interceptor";
import { RequestLoggingInterceptor } from "./common/interceptors/request-logging.interceptor";
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
import { TablesModule } from "./tables/tables.module";
import { ResellersModule } from "./resellers/resellers.module";
import { BillingModule } from "./billing/billing.module";
import { MailModule } from "./common/mail/mail.module";
import { AccountStatusGuard } from "./common/guards/account-status.guard";
import { BlockResellerSupportWriteGuard } from "./common/guards/block-reseller-support-write.guard";
import { HealthModule } from "./health/health.module";
import { validateEnvironment } from "./common/config/environment.validation";
import { LocalStorageModule } from "./common/storage/local-storage.module";
import { MaintenanceModule } from "./common/maintenance/maintenance.module";
import { UsageModule } from "./usage/usage.module";
import { FiscalModule } from "./fiscal/fiscal.module";
import { CashModule } from "./cash/cash.module";
import { ObservabilityModule } from "./common/observability/observability.module";
import { MetricsInterceptor } from "./common/observability/metrics.interceptor";
import { LegacyTestDataModule } from "./common/legacy-test-data/legacy-test-data.module";
import { PlatformSupportModule } from "./platform-support/platform-support.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    LegacyTestDataModule,
    MailModule,
    ObservabilityModule,
    LocalStorageModule,
    MaintenanceModule,
    UsageModule,
    FiscalModule,
    CashModule,
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
    TablesModule,
    ResellersModule,
    BillingModule,
    PlatformSupportModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccountStatusGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: BlockResellerSupportWriteGuard },
    // Antes do de log e do de tenant: mede a requisição inteira, incluindo o
    // tempo gasto pelos próprios interceptors.
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
