import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateCompanySettingsDto {
  @IsOptional()
  openingHours?: Record<string, string>;

  @IsOptional()
  paymentMethodsEnabled?: string[];

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsString()
  aiKnowledgeBase?: string;

  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsers?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxProducts?: number;
}
