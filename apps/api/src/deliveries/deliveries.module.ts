import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { OrdersModule } from "../orders/orders.module";
import { DeliveriesController } from "./deliveries.controller";
import { DeliveriesService } from "./deliveries.service";

@Module({
  imports: [RealtimeModule, OrdersModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
