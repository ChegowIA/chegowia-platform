import { IsEmail, IsIn, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

/**
 * Verticais aceitas pela Meta no perfil comercial. A lista é fechada: mandar um
 * valor fora dela faz a Meta recusar a atualização inteira, então validamos aqui
 * em vez de descobrir no erro do BSP.
 */
export const WHATSAPP_BUSINESS_VERTICALS = [
  "AUTO",
  "BEAUTY",
  "APPAREL",
  "EDU",
  "ENTERTAIN",
  "EVENT_PLAN",
  "FINANCE",
  "GROCERY",
  "GOVT",
  "HOTEL",
  "HEALTH",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
  "NOT_A_BIZ",
  "OTHER",
] as const;

export class UpdateWhatsAppProfileDto {
  /** Frase curta que aparece sob o nome no perfil. */
  @IsOptional()
  @IsString()
  @MaxLength(139)
  about?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsEmail({}, { message: "Informe um e-mail válido para o perfil do WhatsApp." })
  @MaxLength(128)
  email?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: "O site precisa começar com http:// ou https://." })
  @MaxLength(256)
  website1?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: "O segundo site precisa começar com http:// ou https://." })
  @MaxLength(256)
  website2?: string;

  @IsOptional()
  @IsIn(WHATSAPP_BUSINESS_VERTICALS, { message: "Selecione um segmento válido para o perfil do WhatsApp." })
  vertical?: string;
}
