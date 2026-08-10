import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdatePlatformWhatsAppAutomationDto {
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  salesInstructions?: string;
}
