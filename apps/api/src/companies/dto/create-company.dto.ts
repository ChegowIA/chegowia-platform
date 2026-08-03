import { IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { IsCnpj } from "../../common/validators/brazil-document.validator";

export class CreateCompanyDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  @IsCnpj()
  cnpj?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFeeBase?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFeePerKm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  deliveryRadiusKm?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  avgDeliveryTimeMinutes?: number;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}
