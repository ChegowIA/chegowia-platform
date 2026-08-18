import { IsIn, IsOptional } from "class-validator";

/**
 * Forma de pagamento escolhida na ativação.
 *
 * Precisa ser decidida aqui, e não na página do Asaas, porque o valor depende
 * dela: só o cartão carrega a taxa da operadora. Sem escolha, a cobrança sai
 * aceitando todas as formas pelo preço do plano — é o comportamento antigo, que
 * segue valendo para links já emitidos.
 */
export class CompanyCheckoutDto {
  @IsOptional()
  @IsIn(["PIX", "BOLETO", "CREDIT_CARD"], {
    message: "Forma de pagamento inválida.",
  })
  billingType?: "PIX" | "BOLETO" | "CREDIT_CARD";
}
