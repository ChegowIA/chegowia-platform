import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MinLength } from "class-validator";

export class CreatePromotionDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(["PERCENTUAL", "VALOR_FIXO"])
  discountType: string;

  @IsNumber()
  discountValue: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
