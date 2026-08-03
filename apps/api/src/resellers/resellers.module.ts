import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiModule } from "../ai/ai.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ResellersController } from "./resellers.controller";
import { ResellersService } from "./resellers.service";

@Module({
  imports: [AiModule, RealtimeModule, AuthModule],
  controllers: [ResellersController],
  providers: [ResellersService],
  exports: [ResellersService],
})
export class ResellersModule {}
