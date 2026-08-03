import { Module } from "@nestjs/common";
import { GeographyService } from "./geography.service";

@Module({
  providers: [GeographyService],
  exports: [GeographyService],
})
export class GeographyModule {}
