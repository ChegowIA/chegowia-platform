import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { PaymentMethod } from "@prisma/client";

export class CreateOrderItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  variationId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addonIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateOrderDto {
  @IsString()
  companySlug: string;

  @IsString()
  addressId: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
