export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Moeda para valores de consumo, que podem ser menores que um centavo.
 *
 * Uma conversa de IA custa frações de centavo: 3 mil tokens de entrada são
 * R$ 0,0021. Exibir isso com duas casas dá "R$ 0,00" ao lado de "3,3 mil
 * tokens", e quem lê conclui que o sistema não contabilizou — foi exatamente
 * o que aconteceu.
 *
 * Acima de um centavo o formato é o normal, porque `R$ 12,3400` polui uma tela
 * de cobrança sem acrescentar nada.
 */
export function formatUsageCurrency(value: number): string {
  if (value === 0) return formatCurrency(0);
  if (Math.abs(value) >= 0.01) return formatCurrency(value);
  // Abaixo da precisão com que o razão grava, dizer "quase nada" é mais honesto
  // que exibir "R$ 0,000000", que se lê como zero.
  if (Math.abs(value) < 0.000001) return "menos de R$ 0,000001";
  // Casas suficientes para o primeiro dígito significativo aparecer, até seis —
  // a mesma precisão com que o valor é gravado no razão.
  const casas = Math.min(6, Math.max(3, Math.ceil(-Math.log10(Math.abs(value))) + 1));
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/**
 * Preço unitário de uma métrica. Diferente do total de consumo, uma mensagem
 * ou 1M de tokens pode ter mais de duas casas; esconder essa precisão tornaria
 * a explicação de cobrança menos transparente antes da contratação.
 */
export function formatRateCurrency(value: number): string {
  if (value === 0) return formatCurrency(0);
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}
