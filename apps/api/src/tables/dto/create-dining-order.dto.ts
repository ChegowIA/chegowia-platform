import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

class DiningOrderItemDto {
  @IsString()
  @MaxLength(191)
  productId: string;

  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  variationId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  addonIds?: string[];
}

export class CreateDiningOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DiningOrderItemDto)
  items: DiningOrderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
