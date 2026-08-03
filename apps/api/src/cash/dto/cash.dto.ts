import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Length, Min } from "class-validator";
import { CashMovementType } from "@prisma/client";

const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class CreateCashRegisterDto {
  @Transform(trimmed)
  @IsString()
  @Length(2, 60)
  name: string;
}

export class UpdateCashRegisterDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OpenCashSessionDto {
  @IsString()
  cashRegisterId: string;

  /** Valor em dinheiro já na gaveta na abertura (fundo de troco). */
  @IsNumber()
  @Min(0)
  openingAmount: number;
}

export class CashMovementDto {
  @IsEnum(CashMovementType)
  type: CashMovementType;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @Transform(trimmed)
  @IsString()
  @Length(3, 200)
  reason: string;
}

export class CloseCashSessionDto {
  /** Valor efetivamente contado na gaveta. */
  @IsNumber()
  @Min(0)
  countedAmount: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 500)
  notes?: string;
}
