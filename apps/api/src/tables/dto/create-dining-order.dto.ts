import { Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

class DiningOrderItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class CreateDiningOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiningOrderItemDto)
  items: DiningOrderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
