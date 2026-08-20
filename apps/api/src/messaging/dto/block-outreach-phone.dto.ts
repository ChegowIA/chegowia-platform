import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Número que não deve receber prospecção, em nenhum disparo. */
export class BlockOutreachPhoneDto {
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reason?: string;
}
