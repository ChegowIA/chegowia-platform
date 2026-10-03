import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { AddressesController } from "./addresses.controller";
import { AddressesService } from "./addresses.service";
import { GeographyModule } from "../common/geography/geography.module";

@Module({
  imports: [GeographyModule],
  controllers: [CustomersController, AddressesController],
  providers: [CustomersService, AddressesService],
  exports: [CustomersService, AddressesService],
})
export class CustomersModule {}
