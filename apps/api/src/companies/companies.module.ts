import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { CompaniesController } from "./companies.controller";
import { CompaniesService } from "./companies.service";
import { AuthModule } from "../auth/auth.module";
import { GeographyModule } from "../common/geography/geography.module";

@Module({
  imports: [AuthModule, BillingModule, GeographyModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
