import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { PaymentMethod } from "@prisma/client";

export class ProductOptionSelectionDto {
  @IsString()
  groupId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  optionIds: string[];
}

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
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionSelectionDto)
  optionSelections?: ProductOptionSelectionDto[];

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

  /** Consentimento opcional e específico para avisos deste pedido. */
  @IsOptional()
  @IsBoolean()
  whatsappNotificationsAccepted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsappPhone?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
