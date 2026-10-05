import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** Um único modelo Utility por loja, com quatro parâmetros posicionais. */
export class UpdateOrderWhatsAppTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/^$|^[a-z0-9_]+$/i)
  templateName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^$|^[a-z]{2}(?:_[A-Z]{2})?$/)
  languageCode?: string;
}
