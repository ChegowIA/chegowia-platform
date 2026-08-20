import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Erro que aconteceu no navegador.
 *
 * Os campos são poucos e curtos de propósito: é uma rota pública, e aceitar
 * conteúdo livre e grande a transformaria em canal de despejo. O que interessa é
 * a mensagem, onde aconteceu e o rastro — nada de dado da pessoa.
 */
export class ReportClientErrorDto {
  @IsString()
  @MaxLength(500)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  path?: string;

  /** `digest` do Next: liga o erro do navegador ao log do build no servidor. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  digest?: string;
}
