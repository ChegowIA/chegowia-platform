import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Contexto escolhido pelo superadmin multiacesso. Ausente (ou nulo) significa
 * voltar ao papel real de plataforma.
 */
export class SwitchContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  companyId?: string | null;
}
