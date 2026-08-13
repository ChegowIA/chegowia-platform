import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";

/**
 * Dados que o Asaas exige para abrir a subconta do revendedor e que não existem
 * na candidatura: endereço completo e renda declarada. Diferente do Stripe, aqui
 * não há página hospedada de onboarding — a conta é criada pela API, então estes
 * campos precisam vir do nosso formulário.
 *
 * Todos os campos são opcionais aqui porque a mesma rota atende o Stripe, cujo
 * onboarding é chamado sem corpo; a obrigatoriedade é conferida no serviço, no
 * caminho do Asaas, onde dá para dizer exatamente o que falta.
 */
export class AsaasSubaccountDto {
  /** CEP sem máscara; o Asaas recusa pontuação. */
  @IsOptional() @IsString() @Matches(/^\d{8}$/, { message: "Informe o CEP com 8 dígitos, sem traço." }) postalCode?: string;
  @IsOptional() @IsString() @Length(3, 120) address?: string;
  @IsOptional() @IsString() @Length(1, 20) addressNumber?: string;
  /** Bairro. */
  @IsOptional() @IsString() @Length(2, 80) province?: string;
  @IsOptional() @IsString() @Length(1, 60) complement?: string;
  /** Faturamento mensal declarado. O Asaas usa na análise da conta e recusa zero. */
  @IsOptional() @IsInt() @Min(1) @Max(10_000_000) incomeValue?: number;
  /** Nascimento (AAAA-MM-DD) — obrigatório quando o revendedor é pessoa física. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Use o formato AAAA-MM-DD." }) birthDate?: string;
}
