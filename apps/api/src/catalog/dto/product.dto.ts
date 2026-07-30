import { PartialType, OmitType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class ProductVariationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  priceDelta: number;
}

export class ProductAddonDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  @Min(0)
  price: number;
}

export class CreateProductDto {
  @IsString()
  categoryId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariationDto)
  variations?: ProductVariationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAddonDto)
  addons?: ProductAddonDto[];
}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ["variations", "addons"] as const),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
