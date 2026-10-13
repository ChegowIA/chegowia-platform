import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AddressesService } from "./addresses.service";
import { CreateAddressDto, PreviewAddressLocationDto, UpdateAddressDto } from "./dto/address.dto";

@ApiTags("addresses")
@Controller("addresses")
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  list(@CurrentUser("sub") userId: string) {
    return this.addressesService.list(userId);
  }

  @Post()
  create(@CurrentUser("sub") userId: string, @Body() dto: CreateAddressDto) {
    return this.addressesService.create(userId, dto);
  }

  @Post("location-preview")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  previewLocation(@Body() dto: PreviewAddressLocationDto) {
    return this.addressesService.previewLocation(dto);
  }

  @Patch(":id")
  update(@CurrentUser("sub") userId: string, @Param("id") id: string, @Body() dto: UpdateAddressDto) {
    return this.addressesService.update(userId, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    return this.addressesService.remove(userId, id);
  }
}
