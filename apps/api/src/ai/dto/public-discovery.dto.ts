import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class PublicDiscoveryDto {
  @IsString()
  @MinLength(2)
  message: string;

  @IsOptional()
  @IsString()
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
  @IsString()
  neighborhood?: string;
}
