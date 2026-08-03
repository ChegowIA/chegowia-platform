import { Global, Module } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
import { MetricsInterceptor } from "./metrics.interceptor";

@Global()
@Module({
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class ObservabilityModule {}
