import { Global, Module } from "@nestjs/common";
import { TemporaryTestModeService } from "./test-mode.service";

@Global()
@Module({
  providers: [TemporaryTestModeService],
  exports: [TemporaryTestModeService],
})
export class TemporaryTestModeModule {}
