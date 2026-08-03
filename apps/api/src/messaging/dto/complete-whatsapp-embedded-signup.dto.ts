import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

const EMBEDDED_SIGNUP_FINISH_EVENTS = [
  "FINISH",
  "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  "FINISH_OBO_MIGRATION",
  "FINISH_GRANT_ONLY_API_ACCESS",
] as const;

/** Dados efêmeros recebidos do popup oficial da Meta; nenhum token chega ao navegador. */
export class CompleteWhatsAppEmbeddedSignupDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  code: string;

  @IsString()
  @Matches(/^\d{5,32}$/)
  phoneNumberId: string;

  @IsString()
  @Matches(/^\d{5,32}$/)
  businessAccountId: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,32}$/)
  businessPortfolioId?: string;

  @IsString()
  @IsIn(EMBEDDED_SIGNUP_FINISH_EVENTS)
  event: (typeof EMBEDDED_SIGNUP_FINISH_EVENTS)[number];
}
