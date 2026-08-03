import { Module } from "@nestjs/common";
import { MESSAGING_PROVIDER } from "./providers/messaging-provider.interface";
import { LinkWhatsappProvider } from "./providers/link-whatsapp.provider";
import { MessagingService } from "./messaging.service";
import { MessagingController } from "./messaging.controller";
import { MetaWhatsAppProvider } from "./providers/meta-whatsapp.provider";
import { MessagingSecretsService } from "./messaging-secrets.service";
import { AiModule } from "../ai/ai.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { UsageModule } from "../usage/usage.module";

const messagingProviderFactory = {
  provide: MESSAGING_PROVIDER,
  useClass: LinkWhatsappProvider, // Fase 2: trocar por WhatsAppBusinessProvider quando a API oficial for integrada.
};

@Module({
  imports: [AiModule, RealtimeModule, UsageModule],
  controllers: [MessagingController],
  providers: [messagingProviderFactory, MetaWhatsAppProvider, MessagingSecretsService, MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
