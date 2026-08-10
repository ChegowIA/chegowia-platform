import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

/** Credenciais do número institucional — só recebidas pelo servidor e cifradas. */
export class ConnectPlatformWhatsAppCloudDto {
  @IsString()
  @Matches(/^\d{5,32}$/)
  phoneNumberId: string;

  @IsString()
  @Matches(/^\d{5,32}$/)
  businessAccountId: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  salesInstructions?: string;
}
