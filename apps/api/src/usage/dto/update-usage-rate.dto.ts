import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { UsageMetric } from "@prisma/client";

export class UpdateUsageRateDto {
  @IsEnum(UsageMetric)
  metric: UsageMetric;

  @IsString()
  provider: string;

  @IsString()
  label: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  unitSize: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  providerUnitCost: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  markupPercent: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
