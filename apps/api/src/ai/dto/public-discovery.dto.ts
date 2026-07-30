import { IsOptional, IsString, MinLength } from "class-validator";

export class PublicDiscoveryDto {
  @IsString()
  @MinLength(2)
  message: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;
}
