import { Module } from "@nestjs/common";
import { PrismaModule } from "../common/prisma/prisma.module";
import { FiscalController } from "./fiscal.controller";
import { FiscalService } from "./fiscal.service";
import { FiscalSecretsService } from "./fiscal-secrets.service";
import { NfceController } from "./nfce/nfce.controller";
import { NfceService } from "./nfce/nfce.service";
import { SefazClient } from "./nfce/sefaz-client";

@Module({
  imports: [PrismaModule],
  controllers: [FiscalController, NfceController],
  providers: [FiscalService, FiscalSecretsService, NfceService, SefazClient],
  exports: [FiscalService, NfceService],
})
export class FiscalModule {}
