import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { TablesController } from "./tables.controller";
import { TablesService } from "./tables.service";

@Module({
  imports: [RealtimeModule],
  controllers: [TablesController],
  providers: [TablesService],
})
export class TablesModule {}
