import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateWhatsAppAutomationDto {
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  welcomeMessage?: string;
}
