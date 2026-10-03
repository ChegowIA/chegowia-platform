import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class PublicSearchDto {
  @IsString()
  @MaxLength(120)
  query!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: "Informe o CEP com 8 dígitos." })
  zipCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  pageSize?: number;
}
