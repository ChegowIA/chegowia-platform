import { IsString } from "class-validator";

export class DeliveryQuoteDto {
  @IsString()
  companySlug: string;

  @IsString()
  addressId: string;
}
