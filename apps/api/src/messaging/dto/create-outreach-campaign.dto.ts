import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

/**
 * Um disparo é uma lista colada de uma vez.
 *
 * Ritmo e limite vêm no corpo porque cada lista tem um risco diferente: 40
 * contatos de uma feira que pediu contato não é a mesma coisa que 400 números
 * levantados na rua, e a segunda situação pede envio mais lento.
 */
export class CreateOutreachCampaignDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  /** A lista como a pessoa tem: uma linha por contato, ou uma coluna colada. */
  @IsString()
  @MinLength(10)
  @MaxLength(200_000)
  contacts!: string;

  /** Como chamar quem veio sem nome na lista. Modelo não aceita variável vazia. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  fallbackName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  dailyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(3600)
  minIntervalSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(7200)
  maxIntervalSeconds?: number;

  @IsOptional()
  @IsBoolean()
  respectBusinessHours?: boolean;
}
