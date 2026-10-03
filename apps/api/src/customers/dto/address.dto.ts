import { PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, Matches, MinLength } from "class-validator";

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
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
