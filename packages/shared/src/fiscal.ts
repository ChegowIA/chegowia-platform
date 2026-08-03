import { TaxRegime } from "./enums";

/**
 * Tabelas fiscais do produto.
 *
 * Ficam no pacote compartilhado porque a mesma lista precisa aparecer no
 * formulário do painel e ser validada na API — duas cópias divergiriam, e
 * divergência aqui vira rejeição da SEFAZ no balcão.
 */

/**
 * Origem da mercadoria (tabela A do CST). O XML pede o dígito; o enum existe
 * para o código não ficar cheio de números soltos.
 */
export enum TaxOrigin {
  NACIONAL = "NACIONAL",
  ESTRANGEIRA_IMPORTACAO_DIRETA = "ESTRANGEIRA_IMPORTACAO_DIRETA",
  ESTRANGEIRA_MERCADO_INTERNO = "ESTRANGEIRA_MERCADO_INTERNO",
  NACIONAL_IMPORTACAO_ACIMA_40 = "NACIONAL_IMPORTACAO_ACIMA_40",
  NACIONAL_PROCESSOS_BASICOS = "NACIONAL_PROCESSOS_BASICOS",
  NACIONAL_IMPORTACAO_ATE_40 = "NACIONAL_IMPORTACAO_ATE_40",
  ESTRANGEIRA_IMPORTACAO_SEM_SIMILAR = "ESTRANGEIRA_IMPORTACAO_SEM_SIMILAR",
  ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR = "ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR",
  NACIONAL_IMPORTACAO_ACIMA_70 = "NACIONAL_IMPORTACAO_ACIMA_70",
}

/** Dígito que vai no campo `orig` do XML. */
export const TAX_ORIGIN_CODE: Record<TaxOrigin, string> = {
  [TaxOrigin.NACIONAL]: "0",
  [TaxOrigin.ESTRANGEIRA_IMPORTACAO_DIRETA]: "1",
  [TaxOrigin.ESTRANGEIRA_MERCADO_INTERNO]: "2",
  [TaxOrigin.NACIONAL_IMPORTACAO_ACIMA_40]: "3",
  [TaxOrigin.NACIONAL_PROCESSOS_BASICOS]: "4",
  [TaxOrigin.NACIONAL_IMPORTACAO_ATE_40]: "5",
  [TaxOrigin.ESTRANGEIRA_IMPORTACAO_SEM_SIMILAR]: "6",
  [TaxOrigin.ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR]: "7",
  [TaxOrigin.NACIONAL_IMPORTACAO_ACIMA_70]: "8",
};

export const TAX_ORIGIN_LABELS: Record<TaxOrigin, string> = {
  [TaxOrigin.NACIONAL]: "0 — Nacional",
  [TaxOrigin.ESTRANGEIRA_IMPORTACAO_DIRETA]: "1 — Estrangeira, importação direta",
  [TaxOrigin.ESTRANGEIRA_MERCADO_INTERNO]: "2 — Estrangeira, adquirida no mercado interno",
  [TaxOrigin.NACIONAL_IMPORTACAO_ACIMA_40]: "3 — Nacional, conteúdo de importação acima de 40%",
  [TaxOrigin.NACIONAL_PROCESSOS_BASICOS]: "4 — Nacional, produção conforme processos básicos",
  [TaxOrigin.NACIONAL_IMPORTACAO_ATE_40]: "5 — Nacional, conteúdo de importação até 40%",
  [TaxOrigin.ESTRANGEIRA_IMPORTACAO_SEM_SIMILAR]: "6 — Estrangeira, importação direta sem similar nacional",
  [TaxOrigin.ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR]: "7 — Estrangeira, mercado interno sem similar nacional",
  [TaxOrigin.NACIONAL_IMPORTACAO_ACIMA_70]: "8 — Nacional, conteúdo de importação acima de 70%",
};

/**
 * CSOSN — usado por quem está no Simples Nacional. Só os códigos que fazem
 * sentido numa venda ao consumidor final de restaurante; a tabela completa tem
 * casos de substituição tributária e de industrialização que não se aplicam.
 */
export const CSOSN_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "101", label: "101 — Tributada com permissão de crédito" },
  { code: "102", label: "102 — Tributada sem permissão de crédito" },
  { code: "103", label: "103 — Isenção do ICMS para faixa de receita bruta" },
  { code: "300", label: "300 — Imune" },
  { code: "400", label: "400 — Não tributada" },
  { code: "500", label: "500 — ICMS cobrado anteriormente por substituição tributária" },
  { code: "900", label: "900 — Outros" },
];

/** CST de ICMS — usado por Lucro Presumido e Lucro Real. */
export const ICMS_CST_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "00", label: "00 — Tributada integralmente" },
  { code: "20", label: "20 — Com redução de base de cálculo" },
  { code: "40", label: "40 — Isenta" },
  { code: "41", label: "41 — Não tributada" },
  { code: "60", label: "60 — ICMS cobrado anteriormente por substituição tributária" },
  { code: "90", label: "90 — Outras" },
];

/** CST de PIS e COFINS. Os dois usam a mesma tabela. */
export const PIS_COFINS_CST_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "01", label: "01 — Operação tributável, alíquota básica" },
  { code: "02", label: "02 — Operação tributável, alíquota diferenciada" },
  { code: "04", label: "04 — Operação tributável, monofásica, alíquota zero" },
  { code: "06", label: "06 — Operação tributável, alíquota zero" },
  { code: "07", label: "07 — Operação isenta da contribuição" },
  { code: "08", label: "08 — Operação sem incidência da contribuição" },
  { code: "09", label: "09 — Operação com suspensão da contribuição" },
  { code: "49", label: "49 — Outras operações de saída" },
];

/**
 * CFOP de venda ao consumidor. Numa NFC-e a operação é sempre dentro do estado
 * e presencial, então a lista é curta de propósito: oferecer a tabela inteira
 * convida ao erro.
 */
export const CFOP_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "5102", label: "5102 — Venda de mercadoria adquirida de terceiros" },
  { code: "5101", label: "5101 — Venda de produção do estabelecimento" },
  { code: "5405", label: "5405 — Venda de mercadoria com ICMS por substituição tributária" },
  { code: "5933", label: "5933 — Prestação de serviço tributado pelo ISS" },
];

/** Unidades comerciais usuais em restaurante. */
export const UNIT_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "UN", label: "UN — Unidade" },
  { code: "KG", label: "KG — Quilograma" },
  { code: "LT", label: "LT — Litro" },
  { code: "PC", label: "PC — Peça" },
  { code: "CX", label: "CX — Caixa" },
  { code: "PT", label: "PT — Porção" },
];

/** No Simples o código de ICMS é CSOSN; nos demais regimes é CST. */
export function icmsCodeOptions(regime: TaxRegime) {
  return regime === TaxRegime.REGIME_NORMAL ? ICMS_CST_OPTIONS : CSOSN_OPTIONS;
}

export function isValidIcmsCode(regime: TaxRegime, code: string) {
  return icmsCodeOptions(regime).some((option) => option.code === code);
}

export function isValidCode(options: Array<{ code: string }>, code: string) {
  return options.some((option) => option.code === code);
}
