import { PartialType } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

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

  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
