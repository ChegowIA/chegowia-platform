import { PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, Min, MinLength } from "class-validator";

const onlyDigits = ({ value }: { value: unknown }) => String(value ?? "").replace(/\D/g, "");

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsString()
  @MinLength(2)
  street: string;

  @IsString()
  number: string;

  @IsOptional()
  @IsString()
  complement?: string;

  @IsString()
  neighborhood: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{8}$/, { message: "Informe o CEP com 8 dígitos." })
  zipCode: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

export class PreviewAddressLocationDto {
  @IsString()
  @MinLength(2)
  addressLine: string;

  @IsOptional()
  @IsString()
  streetName?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsString()
  @MinLength(2)
  city: string;

  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  state: string;

  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{8}$/)
  zipCode: string;
}
