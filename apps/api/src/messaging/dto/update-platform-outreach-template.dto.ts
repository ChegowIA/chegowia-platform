import { IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Modelo aprovado usado para abrir conversa com quem nunca escreveu.
 *
 * Os dois identificadores convivem porque o Gupshup resolve o modelo de formas
 * diferentes conforme o modo: id no self-serve, nome mais idioma no partner.
 * Guardar os dois evita ter de recadastrar o modelo se a conta mudar de modo.
 */
export class UpdatePlatformOutreachTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  outreachTemplateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  outreachTemplateName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  outreachTemplateLanguage?: string;

  /** O texto exatamente como foi aprovado, com {{1}}, {{2}}… onde entram as variáveis. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outreachTemplateBody?: string;

  /** Qual campo do contato preenche cada variável, na ordem do modelo. */
  @IsOptional()
  @IsArray()
  @IsIn(["nome", "empresa", "atividade", "cidade"], { each: true })
  outreachTemplateParams?: string[];
}
