import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class OpenTableDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerPhone?: string;

  @IsInt()
  @Min(1)
  @Max(30)
  guestCount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
