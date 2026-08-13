import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { AsaasProvider } from "./asaas.provider";
import { AuthModule } from "../auth/auth.module";
import { UsageModule } from "../usage/usage.module";

@Module({
  imports: [AiModule, AuthModule, UsageModule],
  controllers: [BillingController],
  providers: [BillingService, AsaasProvider],
  exports: [BillingService],
})
export class BillingModule {}
