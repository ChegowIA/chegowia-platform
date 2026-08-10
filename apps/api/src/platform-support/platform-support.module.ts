import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { PlatformSupportController } from "./platform-support.controller";
import { PlatformSupportService } from "./platform-support.service";

@Module({
  imports: [AiModule, RealtimeModule],
  controllers: [PlatformSupportController],
  providers: [PlatformSupportService],
  exports: [PlatformSupportService],
})
export class PlatformSupportModule {}
