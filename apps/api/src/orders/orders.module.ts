import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { OrdersController } from "./orders.controller";
import { MyOrdersController } from "./my-orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [RealtimeModule],
  controllers: [OrdersController, MyOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
