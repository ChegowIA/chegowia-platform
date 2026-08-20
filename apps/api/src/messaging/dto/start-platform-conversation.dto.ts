import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Conversa aberta à mão pelo superadmin, a partir de um número digitado. */
export class StartPlatformConversationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /**
   * Só é usada quando a pessoa já escreveu nas últimas 24h. Para número novo o
   * WhatsApp exige modelo aprovado, e o texto digitado aqui seria recusado pelo
   * provedor — a tela avisa antes de deixar enviar.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
