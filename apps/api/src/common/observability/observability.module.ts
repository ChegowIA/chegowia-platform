import { Global, Module } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
import { MetricsInterceptor } from "./metrics.interceptor";
import { ObservabilityController } from "./observability.controller";

@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class ObservabilityModule {}
