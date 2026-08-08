import { Module } from "@nestjs/common";
import { FiscalModule } from "../fiscal/fiscal.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { TablesController } from "./tables.controller";
import { TablesPublicController } from "./tables-public.controller";
import { TablesService } from "./tables.service";

@Module({
  imports: [RealtimeModule, FiscalModule],
  controllers: [TablesController, TablesPublicController],
  providers: [TablesService],
})
export class TablesModule {}
