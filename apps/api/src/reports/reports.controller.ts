import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @RequirePermission(PermissionKey.RELATORIOS_VISUALIZAR)
  @Get("sales")
  sales(@Query("from") from?: string, @Query("to") to?: string) {
    return this.reportsService.salesByPeriod(from, to);
  }

  @RequirePermission(PermissionKey.RELATORIOS_VISUALIZAR)
  @Get("orders-by-status")
  ordersByStatus() {
    return this.reportsService.ordersByStatus();
  }

  @RequirePermission(PermissionKey.RELATORIOS_VISUALIZAR)
  @Get("top-products")
  topProducts(@Query("from") from?: string, @Query("to") to?: string) {
    return this.reportsService.topProducts(from, to);
  }

  @RequirePermission(PermissionKey.RELATORIOS_VISUALIZAR)
  @Get("recurring-customers")
  recurringCustomers() {
    return this.reportsService.recurringCustomers();
  }

  @RequirePermission(PermissionKey.RELATORIOS_VISUALIZAR)
  @Get("delayed-deliveries")
  delayedDeliveries(@Query("thresholdMinutes") thresholdMinutes?: string) {
    return this.reportsService.delayedDeliveries(thresholdMinutes ? Number(thresholdMinutes) : undefined);
  }

  @RequirePermission(PermissionKey.RELATORIOS_VISUALIZAR)
  @Get("motoboy-performance")
  motoboyPerformance() {
    return this.reportsService.motoboyPerformance();
  }

  @RequirePermission(PermissionKey.RELATORIOS_VISUALIZAR)
  @Get("peak-hours")
  peakHours(@Query("from") from?: string, @Query("to") to?: string) {
    return this.reportsService.peakHours(from, to);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("global/overview")
  globalOverview() {
    return this.reportsService.globalOverview();
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("global/top-companies")
  topCompanies() {
    return this.reportsService.topCompaniesByOrders();
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("global/growth")
  growth(@Query("from") from?: string, @Query("to") to?: string) {
    return this.reportsService.growthByPeriod(from, to);
  }
}
