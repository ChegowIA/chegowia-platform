import { Module } from "@nestjs/common";
import { GeographyModule } from "../common/geography/geography.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { FiscalModule } from "../fiscal/fiscal.module";
import { OrdersController } from "./orders.controller";
import { MyOrdersController } from "./my-orders.controller";
import { OrdersService } from "./orders.service";
import { WhatsAppOrdersService } from "./whatsapp-orders.service";
import { OrderWhatsAppNotificationsService } from "./order-whatsapp-notifications.service";
import { GupshupWhatsAppProvider } from "../messaging/providers/gupshup-whatsapp.provider";
import { MessagingSecretsService } from "../messaging/messaging-secrets.service";

@Module({
  imports: [RealtimeModule, GeographyModule, FiscalModule],
  controllers: [OrdersController, MyOrdersController],
  providers: [OrdersService, WhatsAppOrdersService, OrderWhatsAppNotificationsService, GupshupWhatsAppProvider, MessagingSecretsService],
  exports: [OrdersService, WhatsAppOrdersService],
})
export class OrdersModule {}
