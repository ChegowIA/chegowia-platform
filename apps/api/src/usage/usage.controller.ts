import { Body, Controller, Get, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { UpdateUsageRateDto } from "./dto/update-usage-rate.dto";
import { UsageService } from "./usage.service";

@ApiTags("usage")
@Controller("usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Roles(Role.ADMIN)
  @Get("company/summary")
  summary(@CurrentUser("companyId") companyId: string, @Query("month") month?: string) {
    return this.usage.getMonthlySummary(companyId, { reference: parseMonth(month) });
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("admin/rates")
  rates() {
    return this.usage.listRates();
  }

  @Roles(Role.SUPER_ADMIN)
  @Put("admin/rates")
  updateRate(@Body() dto: UpdateUsageRateDto) {
    return this.usage.updateRate(dto);
  }
}

function parseMonth(value?: string) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return new Date();
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
}
