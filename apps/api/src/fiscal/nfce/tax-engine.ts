import { TaxRegime } from "@prisma/client";
import { ResolvedProductTax } from "../product-tax";

/**
 * Motor de cálculo dos tributos da NFC-e.
 *
 * Duas decisões estruturam este arquivo:
 *
 * 1. **Tudo em centavos, em inteiro.** Somar `Number` em reais acumula erro de
 *    ponto flutuante (0.1 + 0.2 ≠ 0.3) e a SEFAZ confere o total contra a soma
 *    dos itens com precisão de centavo. Um centavo de diferença é rejeição.
 *    Converte-se para reais só na saída.
 *
 * 2. **O regime decide o grupo de ICMS.** No Simples sai `ICMSSN` com CSOSN e
 *    sem valor de imposto destacado; no regime normal sai `ICMS` com CST e
 *    valor. São grupos XML diferentes, não o mesmo grupo com valores
 *    diferentes — por isso `icmsGroup` viaja junto com o resultado.
 */

export interface TaxableItem {
  productId: string;
  name: string;
  /** Quantidade; aceita fracionário para itens vendidos por peso. */
  quantity: number;
  /** Preço unitário em reais, já com variação e adicionais embutidos. */
  unitPrice: number;
  tax: ResolvedProductTax;
}

export interface CalculatedItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  tax: ResolvedProductTax;
  /** "ICMSSN" no Simples, "ICMS" no regime normal. */
  icmsGroup: "ICMSSN" | "ICMS";
  icmsBaseCents: number;
  icmsValueCents: number;
  pisBaseCents: number;
  pisValueCents: number;
  cofinsBaseCents: number;
  cofinsValueCents: number;
}

export interface CalculatedTotals {
  productsCents: number;
  deliveryCents: number;
  discountCents: number;
  totalCents: number;
  icmsBaseCents: number;
  icmsValueCents: number;
  pisValueCents: number;
  cofinsValueCents: number;
  /** vTotTrib — valor aproximado dos tributos, exigido pela Lei 12.741. */
  approximateTaxCents: number;
}

export interface TaxCalculation {
  items: CalculatedItem[];
  totals: CalculatedTotals;
}

/**
 * CSOSN que não destacam ICMS. 102 (sem crédito) é o caso da esmagadora
 * maioria dos restaurantes do Simples; 500 é mercadoria já tributada por
 * substituição, onde destacar de novo seria cobrar duas vezes.
 */
const CSOSN_SEM_DESTAQUE = new Set(["102", "103", "300", "400", "500"]);

/** CST de ICMS sem valor a destacar: isento, não tributado, já retido por ST. */
const CST_SEM_DESTAQUE = new Set(["40", "41", "50", "60"]);

/** CST de PIS/COFINS que não geram valor. */
const PIS_COFINS_SEM_VALOR = new Set(["04", "06", "07", "08", "09"]);

/**
 * Percentual aproximado de tributos sobre o total (Lei 12.741 / "De olho no
 * imposto"). É estimativa por definição — o IBPT publica a tabela oficial por
 * NCM e integrar isso é um projeto próprio. Enquanto não existe, usa-se a
 * alíquota efetiva média do Simples para alimentação, que é o que a maioria
 * dos emissores faz e o que a lei aceita como aproximação de boa-fé.
 */
const APPROXIMATE_TAX_RATE_BY_REGIME: Record<TaxRegime, number> = {
  [TaxRegime.SIMPLES_NACIONAL]: 0.0865,
  [TaxRegime.SIMPLES_NACIONAL_EXCESSO]: 0.115,
  [TaxRegime.REGIME_NORMAL]: 0.1825,
};

export function toCents(value: number) {
  // Math.round sobre o valor já multiplicado evita o erro clássico de
  // truncamento: 19.99 * 100 vira 1998.9999999999998 em ponto flutuante.
  return Math.round(value * 100);
}

export function fromCents(cents: number) {
  return Math.round(cents) / 100;
}

/** Percentual sobre uma base em centavos, arredondado a centavo. */
function applyRate(baseCents: number, rate: number) {
  return Math.round((baseCents * rate) / 100);
}

export function calculateTaxes(
  regime: TaxRegime,
  items: TaxableItem[],
  options: { deliveryFee?: number; discount?: number } = {},
): TaxCalculation {
  const simples = regime !== TaxRegime.REGIME_NORMAL;

  const calculated: CalculatedItem[] = items.map((item) => {
    const unitPriceCents = toCents(item.unitPrice);
    // O total do item é calculado sobre centavos e arredondado uma única vez.
    // Arredondar por etapa (unitário, depois total) acumula divergência.
    const totalCents = Math.round(unitPriceCents * item.quantity);

    const destacaIcms = simples
      ? !CSOSN_SEM_DESTAQUE.has(item.tax.icmsCode)
      : !CST_SEM_DESTAQUE.has(item.tax.icmsCode);

    const icmsBaseCents = destacaIcms ? totalCents : 0;
    const icmsValueCents = destacaIcms ? applyRate(icmsBaseCents, item.tax.icmsRate) : 0;

    const pisTributa = !PIS_COFINS_SEM_VALOR.has(item.tax.pisCode);
    const cofinsTributa = !PIS_COFINS_SEM_VALOR.has(item.tax.cofinsCode);
    const pisBaseCents = pisTributa ? totalCents : 0;
    const cofinsBaseCents = cofinsTributa ? totalCents : 0;

    return {
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents,
      totalCents,
      tax: item.tax,
      icmsGroup: simples ? "ICMSSN" : "ICMS",
      icmsBaseCents,
      icmsValueCents,
      pisBaseCents,
      pisValueCents: pisTributa ? applyRate(pisBaseCents, item.tax.pisRate) : 0,
      cofinsBaseCents,
      cofinsValueCents: cofinsTributa ? applyRate(cofinsBaseCents, item.tax.cofinsRate) : 0,
    };
  });

  const productsCents = calculated.reduce((sum, item) => sum + item.totalCents, 0);
  const deliveryCents = toCents(options.deliveryFee ?? 0);
  const discountCents = toCents(options.discount ?? 0);

  const totals: CalculatedTotals = {
    productsCents,
    deliveryCents,
    discountCents,
    totalCents: productsCents + deliveryCents - discountCents,
    icmsBaseCents: calculated.reduce((sum, item) => sum + item.icmsBaseCents, 0),
    icmsValueCents: calculated.reduce((sum, item) => sum + item.icmsValueCents, 0),
    pisValueCents: calculated.reduce((sum, item) => sum + item.pisValueCents, 0),
    cofinsValueCents: calculated.reduce((sum, item) => sum + item.cofinsValueCents, 0),
    approximateTaxCents: 0,
  };
  totals.approximateTaxCents = Math.round(
    totals.totalCents * APPROXIMATE_TAX_RATE_BY_REGIME[regime],
  );

  return { items: calculated, totals };
}

/**
 * Formata um valor monetário no padrão do XML: ponto decimal, duas casas, sem
 * separador de milhar. `toFixed` sobre reais reintroduziria o erro de ponto
 * flutuante que o cálculo em centavos evitou.
 */
export function xmlAmount(cents: number) {
  const sinal = cents < 0 ? "-" : "";
  const absoluto = Math.abs(Math.round(cents));
  return `${sinal}${Math.floor(absoluto / 100)}.${String(absoluto % 100).padStart(2, "0")}`;
}

/** Quantidade e valor unitário aceitam até 4 casas no layout. */
export function xmlQuantity(value: number) {
  return value.toFixed(4);
}

export function xmlUnitPrice(cents: number) {
  return (cents / 100).toFixed(4);
}

/** Alíquota no XML: duas casas decimais. */
export function xmlRate(rate: number) {
  return rate.toFixed(2);
}
