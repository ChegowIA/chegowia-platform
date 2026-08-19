import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { CompaniesController } from "./companies.controller";
import { CompaniesService } from "./companies.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
