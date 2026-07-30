import { Module } from "@nestjs/common";
import { MESSAGING_PROVIDER } from "./providers/messaging-provider.interface";
import { LinkWhatsappProvider } from "./providers/link-whatsapp.provider";
import { MessagingService } from "./messaging.service";
import { MessagingController } from "./messaging.controller";

const messagingProviderFactory = {
  provide: MESSAGING_PROVIDER,
  useClass: LinkWhatsappProvider, // Fase 2: trocar por WhatsAppBusinessProvider quando a API oficial for integrada.
};

@Module({
  controllers: [MessagingController],
  providers: [messagingProviderFactory, MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
