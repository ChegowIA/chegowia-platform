import { Module } from "@nestjs/common";
import { MESSAGING_PROVIDER } from "./providers/messaging-provider.interface";
import { LinkWhatsappProvider } from "./providers/link-whatsapp.provider";
import { MessagingService } from "./messaging.service";
import { MessagingController } from "./messaging.controller";
import { GupshupWhatsAppProvider } from "./providers/gupshup-whatsapp.provider";
import { MessagingSecretsService } from "./messaging-secrets.service";
import { PlatformWhatsAppController } from "./platform-whatsapp.controller";
import { PlatformWhatsAppService } from "./platform-whatsapp.service";
import { PlatformOutreachService } from "./platform-outreach.service";
import { OutreachIntelligenceService } from "./outreach-intelligence.service";
import { BaileysOutreachSenderService } from "./baileys-outreach-sender.service";
import { OutreachAuthStoreService } from "./outreach-auth-store.service";
import { OutreachInboundService } from "./outreach-inbound.service";
import { AiModule } from "../ai/ai.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { UsageModule } from "../usage/usage.module";

const messagingProviderFactory = {
  provide: MESSAGING_PROVIDER,
  useClass: LinkWhatsappProvider, // Fase 2: trocar por WhatsAppBusinessProvider quando a API oficial for integrada.
};

@Module({
  imports: [AiModule, RealtimeModule, UsageModule],
  controllers: [MessagingController, PlatformWhatsAppController],
  providers: [
    messagingProviderFactory,
    GupshupWhatsAppProvider,
    MessagingSecretsService,
    PlatformWhatsAppService,
    PlatformOutreachService,
    OutreachIntelligenceService,
    BaileysOutreachSenderService,
    OutreachAuthStoreService,
    OutreachInboundService,
    MessagingService,
  ],
  exports: [MessagingService, PlatformWhatsAppService, PlatformOutreachService],
})
export class MessagingModule {}
