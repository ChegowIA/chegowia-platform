import { Module } from "@nestjs/common";
import { PrismaModule } from "../common/prisma/prisma.module";
import { CashController } from "./cash.controller";
import { CashService } from "./cash.service";

@Module({
  imports: [PrismaModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
