import { Transform } from "class-transformer";
import { IsNumber, IsOptional, IsString, Matches, Min, MinLength } from "class-validator";
import { IsCnpj } from "../../common/validators/brazil-document.validator";

const onlyDigits = ({ value }: { value: unknown }) => String(value ?? "").replace(/\D/g, "");
const trimmed = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const upper = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toUpperCase() : value;

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

  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  addressLine: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  city: string;

  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: "Informe a UF com duas letras." })
  state: string;

  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{8}$/, { message: "Informe o CEP com 8 dígitos." })
  zipCode: string;

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
