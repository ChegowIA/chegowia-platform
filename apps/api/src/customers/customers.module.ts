import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { AddressesController } from "./addresses.controller";
import { AddressesService } from "./addresses.service";

@Module({
  controllers: [CustomersController, AddressesController],
  providers: [CustomersService, AddressesService],
  exports: [CustomersService, AddressesService],
})
export class CustomersModule {}
