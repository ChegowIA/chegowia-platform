"use client";

import {
  CFOP_OPTIONS,
  PIS_COFINS_CST_OPTIONS,
  TAX_ORIGIN_LABELS,
  TaxOrigin,
  TaxRegime,
  UNIT_OPTIONS,
  icmsCodeOptions,
} from "@chegowia/shared";
import { FormField, Input, Select } from "@/components/ui/input";

export interface ProductTaxDraft {
  ncm: string;
  cest: string;
  cfop: string;
  taxOrigin: string;
  icmsCode: string;
  icmsRate: string;
  pisCode: string;
  pisRate: string;
  cofinsCode: string;
  cofinsRate: string;
  unit: string;
}

export const EMPTY_PRODUCT_TAX: ProductTaxDraft = {
  ncm: "",
  cest: "",
  cfop: "",
  taxOrigin: "",
  icmsCode: "",
  icmsRate: "",
  pisCode: "",
  pisRate: "",
  cofinsCode: "",
  cofinsRate: "",
  unit: "",
};

/**
 * Converte o rascunho para o corpo da requisição.
 *
 * Campo em branco vira `undefined`, não string vazia: no backend a ausência é
 * o que significa "herda o padrão da empresa". Mandar `""` gravaria um valor
 * vazio e quebraria a herança.
 */
export function productTaxPayload(draft: ProductTaxDraft) {
  const texto = (value: string) => (value.trim() ? value.trim() : undefined);
  const numero = (value: string) => (value.trim() ? Number(value) : undefined);
  return {
    ncm: texto(draft.ncm),
    cest: texto(draft.cest),
    cfop: texto(draft.cfop),
    taxOrigin: (texto(draft.taxOrigin) as TaxOrigin | undefined),
    icmsCode: texto(draft.icmsCode),
    icmsRate: numero(draft.icmsRate),
    pisCode: texto(draft.pisCode),
    pisRate: numero(draft.pisRate),
    cofinsCode: texto(draft.cofinsCode),
    cofinsRate: numero(draft.cofinsRate),
    unit: texto(draft.unit),
  };
}

export function productTaxDraftFrom(product: Partial<Record<keyof ProductTaxDraft, unknown>>): ProductTaxDraft {
  const valor = (chave: keyof ProductTaxDraft) => {
    const bruto = product[chave];
    return bruto === null || bruto === undefined ? "" : String(bruto);
  };
  return {
    ncm: valor("ncm"),
    cest: valor("cest"),
    cfop: valor("cfop"),
    taxOrigin: valor("taxOrigin"),
    icmsCode: valor("icmsCode"),
    icmsRate: valor("icmsRate"),
    pisCode: valor("pisCode"),
    pisRate: valor("pisRate"),
    cofinsCode: valor("cofinsCode"),
    cofinsRate: valor("cofinsRate"),
    unit: valor("unit"),
  };
}

/**
 * Tributação do item, no cadastro de produto.
 *
 * Todo campo tem a opção "usar o padrão da empresa" e ela é o valor inicial —
 * um restaurante tem centenas de itens e quase todos compartilham a mesma
 * tributação. Preencher aqui só faz sentido para o que difere, tipicamente o
 * NCM de bebidas.
 */
export function ProductTaxFields({
  value,
  onChange,
  regime,
}: {
  value: ProductTaxDraft;
  onChange: (next: ProductTaxDraft) => void;
  regime: TaxRegime;
}) {
  const set = <K extends keyof ProductTaxDraft>(campo: K, novo: string) =>
    onChange({ ...value, [campo]: novo });

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div>
        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Tributação</p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Deixe em branco para usar o padrão configurado em Fiscal. Preencha apenas o que for
          diferente neste item — o NCM de bebidas costuma ser o único.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="NCM">
          <Input
            inputMode="numeric"
            placeholder="Padrão da empresa"
            value={value.ncm}
            onChange={(e) => set("ncm", e.target.value)}
          />
        </FormField>
        <FormField label="CEST">
          <Input
            inputMode="numeric"
            placeholder="Padrão da empresa"
            value={value.cest}
            onChange={(e) => set("cest", e.target.value)}
          />
        </FormField>
        <FormField label="CFOP">
          <HerdaSelect value={value.cfop} onChange={(v) => set("cfop", v)} options={CFOP_OPTIONS} />
        </FormField>
        <FormField label="Origem">
          <HerdaSelect
            value={value.taxOrigin}
            onChange={(v) => set("taxOrigin", v)}
            options={Object.entries(TAX_ORIGIN_LABELS).map(([code, label]) => ({ code, label }))}
          />
        </FormField>
        <FormField label={regime === TaxRegime.REGIME_NORMAL ? "CST de ICMS" : "CSOSN"}>
          <HerdaSelect value={value.icmsCode} onChange={(v) => set("icmsCode", v)} options={icmsCodeOptions(regime)} />
        </FormField>
        <FormField label="Alíquota de ICMS (%)">
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="Padrão da empresa"
            value={value.icmsRate}
            onChange={(e) => set("icmsRate", e.target.value)}
          />
        </FormField>
        <FormField label="CST de PIS">
          <HerdaSelect value={value.pisCode} onChange={(v) => set("pisCode", v)} options={PIS_COFINS_CST_OPTIONS} />
        </FormField>
        <FormField label="Alíquota de PIS (%)">
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="Padrão da empresa"
            value={value.pisRate}
            onChange={(e) => set("pisRate", e.target.value)}
          />
        </FormField>
        <FormField label="CST de COFINS">
          <HerdaSelect value={value.cofinsCode} onChange={(v) => set("cofinsCode", v)} options={PIS_COFINS_CST_OPTIONS} />
        </FormField>
        <FormField label="Alíquota de COFINS (%)">
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="Padrão da empresa"
            value={value.cofinsRate}
            onChange={(e) => set("cofinsRate", e.target.value)}
          />
        </FormField>
        <FormField label="Unidade">
          <HerdaSelect value={value.unit} onChange={(v) => set("unit", v)} options={UNIT_OPTIONS} />
        </FormField>
      </div>
    </div>
  );
}

/** Select com a opção vazia significando herança, sempre em primeiro lugar. */
function HerdaSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ code: string; label: string }>;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Padrão da empresa</option>
      {options.map((option) => (
        <option key={option.code} value={option.code}>{option.label}</option>
      ))}
    </Select>
  );
}
