import { TaxOrigin, TaxRegime } from "@prisma/client";
import {
  CFOP_OPTIONS,
  PIS_COFINS_CST_OPTIONS,
  TaxRegime as SharedTaxRegime,
  UNIT_OPTIONS,
  icmsCodeOptions,
  isValidCode,
} from "@chegowia/shared";

/** Tributação completa de um item, pronta para virar linha do XML. */
export interface ResolvedProductTax {
  ncm: string;
  cest: string | null;
  cfop: string;
  taxOrigin: TaxOrigin;
  icmsCode: string;
  icmsRate: number;
  /** Redução da base de cálculo, em percentual. Obrigatória no CST 20. */
  icmsReductionRate: number | null;
  pisCode: string;
  pisRate: number;
  cofinsCode: string;
  cofinsRate: number;
  unit: string;
}

export interface ProductTaxResolution {
  /** Preenchida apenas quando não há pendência — senão não é emissível. */
  tax: ResolvedProductTax | null;
  /** Frases em pt-BR, prontas para a tela. */
  pendencias: string[];
  /** Campos que vieram do padrão da empresa, para a tela sinalizar herança. */
  herdados: string[];
}

/**
 * Resolve a tributação de um produto combinando o padrão da empresa com as
 * sobrescritas do item.
 *
 * A regra é uma só: campo nulo no produto significa "usa o da empresa". Sem
 * isso, cada item do cardápio precisaria repetir a mesma tributação, e o que
 * acontece na prática é cadastro pela metade — descoberto quando a SEFAZ
 * rejeita a nota, com o cliente esperando no balcão.
 *
 * As pendências são devolvidas em vez de lançadas: a tela precisa listar tudo
 * que falta de uma vez, não o primeiro erro encontrado.
 */
export function resolveProductTax(
  profile: {
    taxRegime: TaxRegime;
    defaultNcm: string | null;
    defaultCest: string | null;
    defaultCfop: string;
    defaultTaxOrigin: TaxOrigin;
    defaultIcmsCode: string | null;
    defaultIcmsRate: unknown;
    defaultIcmsReductionRate?: unknown;
    defaultPisCode: string | null;
    defaultPisRate: unknown;
    defaultCofinsCode: string | null;
    defaultCofinsRate: unknown;
    defaultUnit: string;
  } | null,
  product: {
    name?: string;
    ncm: string | null;
    cest: string | null;
    cfop: string | null;
    taxOrigin: TaxOrigin | null;
    icmsCode: string | null;
    icmsRate: unknown;
    icmsReductionRate?: unknown;
    pisCode: string | null;
    pisRate: unknown;
    cofinsCode: string | null;
    cofinsRate: unknown;
    unit: string | null;
  },
): ProductTaxResolution {
  if (!profile) {
    return { tax: null, pendencias: ["Cadastro fiscal da empresa não preenchido."], herdados: [] };
  }

  const pendencias: string[] = [];
  const herdados: string[] = [];

  const pick = <T>(campo: string, doProduto: T | null | undefined, daEmpresa: T | null | undefined) => {
    if (doProduto !== null && doProduto !== undefined) return doProduto;
    if (daEmpresa !== null && daEmpresa !== undefined) herdados.push(campo);
    return daEmpresa ?? null;
  };

  const ncm = pick("ncm", product.ncm, profile.defaultNcm);
  const cest = pick("cest", product.cest, profile.defaultCest);
  const cfop = pick("cfop", product.cfop, profile.defaultCfop);
  const taxOrigin = pick("taxOrigin", product.taxOrigin, profile.defaultTaxOrigin);
  const icmsCode = pick("icmsCode", product.icmsCode, profile.defaultIcmsCode);
  const icmsRate = toNumber(pick("icmsRate", product.icmsRate, profile.defaultIcmsRate));
  const icmsReductionRate = toNumber(
    pick("icmsReductionRate", product.icmsReductionRate, profile.defaultIcmsReductionRate),
  );
  const pisCode = pick("pisCode", product.pisCode, profile.defaultPisCode);
  const pisRate = toNumber(pick("pisRate", product.pisRate, profile.defaultPisRate));
  const cofinsCode = pick("cofinsCode", product.cofinsCode, profile.defaultCofinsCode);
  const cofinsRate = toNumber(pick("cofinsRate", product.cofinsRate, profile.defaultCofinsRate));
  const unit = pick("unit", product.unit, profile.defaultUnit);

  if (!ncm) pendencias.push("NCM não informado.");
  else if (!/^\d{8}$/.test(ncm)) pendencias.push("NCM deve ter 8 dígitos.");
  if (cest && !/^\d{7}$/.test(cest)) pendencias.push("CEST deve ter 7 dígitos.");
  if (!cfop) pendencias.push("CFOP não informado.");
  else if (!isValidCode(CFOP_OPTIONS, cfop)) pendencias.push(`CFOP ${cfop} não é válido para venda ao consumidor.`);

  if (!icmsCode) {
    pendencias.push(
      profile.taxRegime === TaxRegime.REGIME_NORMAL
        ? "CST de ICMS não informado."
        : "CSOSN não informado.",
    );
  } else if (!isValidIcmsForRegime(profile.taxRegime, icmsCode)) {
    // A confusão mais comum: CSOSN preenchido em empresa de regime normal, ou
    // CST em empresa do Simples. Os dois passam num campo de texto e só a
    // SEFAZ reclama, então a checagem é aqui.
    pendencias.push(
      profile.taxRegime === TaxRegime.REGIME_NORMAL
        ? `${icmsCode} não é um CST de ICMS válido — no regime normal use CST, não CSOSN.`
        : `${icmsCode} não é um CSOSN válido — no Simples Nacional use CSOSN, não CST.`,
    );
  }

  if (!pisCode) pendencias.push("CST de PIS não informado.");
  else if (!isValidCode(PIS_COFINS_CST_OPTIONS, pisCode)) pendencias.push(`CST de PIS ${pisCode} não é válido.`);
  if (!cofinsCode) pendencias.push("CST de COFINS não informado.");
  else if (!isValidCode(PIS_COFINS_CST_OPTIONS, cofinsCode)) pendencias.push(`CST de COFINS ${cofinsCode} não é válido.`);

  if (!unit) pendencias.push("Unidade comercial não informada.");
  else if (!isValidCode(UNIT_OPTIONS, unit)) pendencias.push(`Unidade ${unit} não é reconhecida.`);

  for (const [rotulo, valor] of [
    ["ICMS", icmsRate],
    ["PIS", pisRate],
    ["COFINS", cofinsRate],
    ["redução de base", icmsReductionRate],
  ] as const) {
    if (valor !== null && (valor < 0 || valor > 100)) {
      pendencias.push(`A alíquota de ${rotulo} precisa estar entre 0 e 100.`);
    }
  }

  // O CST 20 é "com redução de base de cálculo": o XML exige o percentual de
  // redução junto do CST, e sem ele a SEFAZ recusa por schema. Cobrar aqui
  // evita descobrir isso com o cliente no balcão.
  if (icmsCode === "20" && (icmsReductionRate === null || icmsReductionRate <= 0)) {
    pendencias.push("O CST 20 exige o percentual de redução da base de cálculo.");
  }

  if (pendencias.length) return { tax: null, pendencias, herdados };

  return {
    tax: {
      ncm: ncm!,
      cest: cest ?? null,
      cfop: cfop!,
      taxOrigin: taxOrigin!,
      icmsCode: icmsCode!,
      // Alíquota ausente vale zero: CSOSN 102 e CST 40, os casos mais comuns
      // em restaurante do Simples, não têm alíquota própria.
      icmsRate: icmsRate ?? 0,
      icmsReductionRate,
      pisCode: pisCode!,
      pisRate: pisRate ?? 0,
      cofinsCode: cofinsCode!,
      cofinsRate: cofinsRate ?? 0,
      unit: unit!,
    },
    pendencias,
    herdados,
  };
}

/**
 * O enum do Prisma e o do pacote compartilhado têm os mesmos valores mas são
 * tipos distintos; a ponte fica aqui, num lugar só.
 */
function isValidIcmsForRegime(regime: TaxRegime, code: string) {
  return icmsCodeOptions(regime as unknown as SharedTaxRegime).some((option) => option.code === code);
}

/** Decimal do Prisma, string do formulário ou número — tudo vira número. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
