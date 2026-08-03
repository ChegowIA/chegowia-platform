import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ConnectWhatsAppCloudDto {
  @IsString()
  @Matches(/^\d{5,32}$/)
  phoneNumberId: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,32}$/)
  businessAccountId?: string;

  @IsString()
  @MinLength(20)
  accessToken: string;

  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  welcomeMessage?: string;
}
