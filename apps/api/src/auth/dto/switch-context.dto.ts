import { Role } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Contexto escolhido pelo superadmin multiacesso. Ausente (ou nulo) significa
 * voltar ao papel real de plataforma.
 */
export class SwitchContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  companyId?: string | null;

  /**
   * Papel a assumir. Ausente com empresa significa ADMIN, que é o caso comum;
   * o serviço recusa papel que não faça sentido para o contexto escolhido.
   */
  @IsOptional()
  @IsEnum(Role, { message: "Papel de acesso inválido." })
  role?: Role;
}
