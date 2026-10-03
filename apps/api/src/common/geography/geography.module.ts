import { Module } from "@nestjs/common";
import { GeographyService } from "./geography.service";
import { PostalCodeLocationService } from "./postal-code-location.service";

@Module({
  providers: [GeographyService, PostalCodeLocationService],
  exports: [GeographyService, PostalCodeLocationService],
})
export class GeographyModule {}
