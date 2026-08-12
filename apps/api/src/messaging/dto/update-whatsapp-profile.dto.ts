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

/**
 * O endereço é estruturado no perfil do WhatsApp, não um texto livre. Enviá-lo
 * como campo único fazia o provedor descartar tudo em silêncio — o painel dizia
 * que salvou e nada mudava na conversa do cliente.
 */
export class UpdateWhatsAppProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pinCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

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
