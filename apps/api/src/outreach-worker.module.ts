import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AI_PROVIDER } from "./ai/providers/ai-provider.interface";
import { DeepSeekProvider } from "./ai/providers/deepseek.provider";
import { validateOutreachWorkerEnvironment } from "./common/config/outreach-worker-environment.validation";
import { PrismaModule } from "./common/prisma/prisma.module";
import { BaileysOutreachSenderService } from "./messaging/baileys-outreach-sender.service";
import { OutreachAuthStoreService } from "./messaging/outreach-auth-store.service";
import { OutreachInboundService } from "./messaging/outreach-inbound.service";
import { OutreachIntelligenceService } from "./messaging/outreach-intelligence.service";
import { PlatformOutreachService } from "./messaging/platform-outreach.service";

/** Processo sem HTTP nem módulos operacionais: somente a fila e a sessão QR. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateOutreachWorkerEnvironment }),
    PrismaModule,
  ],
  providers: [
    { provide: AI_PROVIDER, useClass: DeepSeekProvider },
    OutreachIntelligenceService,
    OutreachInboundService,
    OutreachAuthStoreService,
    BaileysOutreachSenderService,
    PlatformOutreachService,
  ],
})
export class OutreachWorkerModule {}
