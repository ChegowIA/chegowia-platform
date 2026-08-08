import { Module } from "@nestjs/common";
import { GeographyModule } from "../common/geography/geography.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { FiscalModule } from "../fiscal/fiscal.module";
import { OrdersController } from "./orders.controller";
import { MyOrdersController } from "./my-orders.controller";
import { OrdersService } from "./orders.service";
import { WhatsAppOrdersService } from "./whatsapp-orders.service";

@Module({
  imports: [RealtimeModule, GeographyModule, FiscalModule],
  controllers: [OrdersController, MyOrdersController],
  providers: [OrdersService, WhatsAppOrdersService],
  exports: [OrdersService, WhatsAppOrdersService],
})
export class OrdersModule {}
