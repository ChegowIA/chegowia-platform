import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from "class-validator";
import { PartialType } from "@nestjs/swagger";

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  position?: number;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
