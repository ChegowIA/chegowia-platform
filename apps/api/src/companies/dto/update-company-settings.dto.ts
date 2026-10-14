import { IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from "class-validator";
import { PaymentMethod } from "@prisma/client";

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsObject()
  openingHours?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @IsEnum(PaymentMethod, { each: true })
  paymentMethodsEnabled?: PaymentMethod[];

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

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
