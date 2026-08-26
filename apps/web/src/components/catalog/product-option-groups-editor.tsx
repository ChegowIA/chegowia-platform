"use client";

import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";

export type ProductOptionDraft = {
  name: string;
  priceDelta: string;
};

export type ProductOptionGroupDraft = {
  name: string;
  description: string;
  selectionType: "SINGLE" | "MULTIPLE";
  minSelections: string;
  maxSelections: string;
  pricingRule: "SUM" | "HIGHEST" | "AVERAGE";
  options: ProductOptionDraft[];
};

export function optionGroupDraftFrom(groups: Array<{
  name: string;
  description?: string | null;
  selectionType: "SINGLE" | "MULTIPLE";
  minSelections: number;
  maxSelections: number;
  pricingRule: "SUM" | "HIGHEST" | "AVERAGE";
  options: Array<{ name: string; priceDelta: number }>;
}> | undefined): ProductOptionGroupDraft[] {
  return (groups ?? []).map((group) => ({
    name: group.name,
    description: group.description ?? "",
    selectionType: group.selectionType,
    minSelections: String(group.minSelections),
    maxSelections: String(group.maxSelections),
    pricingRule: group.pricingRule,
    options: group.options.map((option) => ({ name: option.name, priceDelta: String(option.priceDelta) })),
  }));
}

export function productOptionGroupsPayload(drafts: ProductOptionGroupDraft[]) {
  return drafts.map((group) => ({
    name: group.name.trim(),
    description: group.description.trim() || undefined,
    selectionType: group.selectionType,
    minSelections: Number(group.minSelections),
    maxSelections: Number(group.maxSelections),
    pricingRule: group.pricingRule,
    options: group.options.map((option) => ({
      name: option.name.trim(),
      priceDelta: Number(option.priceDelta || 0),
    })),
  }));
}

const newGroup = (): ProductOptionGroupDraft => ({
  name: "Nova escolha",
  description: "",
  selectionType: "SINGLE",
  minSelections: "0",
  maxSelections: "1",
  pricingRule: "SUM",
  options: [{ name: "Opção 1", priceDelta: "0" }],
});

const sizeTemplate = (): ProductOptionGroupDraft[] => [
  {
    name: "Tamanho",
    description: "Escolha o tamanho que melhor atende ao pedido.",
    selectionType: "SINGLE",
    minSelections: "1",
    maxSelections: "1",
    pricingRule: "SUM",
    options: [
      { name: "Pequeno", priceDelta: "0" },
      { name: "Médio", priceDelta: "0" },
      { name: "Grande", priceDelta: "0" },
      { name: "Extra grande", priceDelta: "0" },
    ],
  },
];

const pizzaTemplate = (): ProductOptionGroupDraft[] => [
  {
    name: "Tamanho",
    description: "Defina os tamanhos da pizza e o acréscimo de cada um sobre o preço-base.",
    selectionType: "SINGLE",
    minSelections: "1",
    maxSelections: "1",
    pricingRule: "SUM",
    options: [
      { name: "Pequena", priceDelta: "0" },
      { name: "Média", priceDelta: "0" },
      { name: "Grande", priceDelta: "0" },
      { name: "Extra grande", priceDelta: "0" },
    ],
  },
  {
    name: "Sabores",
    description: "A regra começa em até 2 sabores; altere o máximo para 3, 4 ou o que sua pizzaria permitir.",
    selectionType: "MULTIPLE",
    minSelections: "1",
    maxSelections: "2",
    pricingRule: "HIGHEST",
    options: [
      { name: "Mussarela", priceDelta: "0" },
      { name: "Calabresa", priceDelta: "0" },
    ],
  },
];

export function ProductOptionGroupsEditor({
  value,
  onChange,
}: {
  value: ProductOptionGroupDraft[];
  onChange: (value: ProductOptionGroupDraft[]) => void;
}) {
  function updateGroup(index: number, patch: Partial<ProductOptionGroupDraft>) {
    onChange(value.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function updateOption(groupIndex: number, optionIndex: number, patch: Partial<ProductOptionDraft>) {
    updateGroup(groupIndex, {
      options: value[groupIndex].options.map((option, index) => index === optionIndex ? { ...option, ...patch } : option),
    });
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-900/60 dark:bg-brand-950/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-black text-brand-950 dark:text-brand-100">Montagem e opções do produto</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-brand-800/80 dark:text-brand-200/80">Crie grupos para tamanho, sabores, ponto, massa, acompanhamentos ou qualquer escolha. O sistema valida o mínimo e o máximo definidos por você antes de aceitar o pedido.</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-brand-800 shadow-sm dark:bg-slate-900 dark:text-brand-200">{value.length} {value.length === 1 ? "grupo" : "grupos"}</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Button type="button" size="sm" variant="outline" className="border-brand-200 bg-white text-brand-800 hover:bg-brand-100 dark:border-brand-800 dark:bg-slate-900 dark:text-brand-200" onClick={() => onChange(pizzaTemplate())}>Modelo pizza</Button>
        <Button type="button" size="sm" variant="outline" className="border-brand-200 bg-white text-brand-800 hover:bg-brand-100 dark:border-brand-800 dark:bg-slate-900 dark:text-brand-200" onClick={() => onChange(sizeTemplate())}>Modelo tamanhos</Button>
        <Button type="button" size="sm" variant="outline" className="border-brand-200 bg-white text-brand-800 hover:bg-brand-100 dark:border-brand-800 dark:bg-slate-900 dark:text-brand-200" onClick={() => onChange([...value, newGroup()])}>+ Grupo personalizado</Button>
      </div>

      {value.length > 0 && <p className="mt-3 text-[11px] leading-5 text-brand-900/75 dark:text-brand-200/75">No modelo pizza, “valor mais alto” cobra apenas o maior acréscimo entre os sabores escolhidos. Edite os nomes, preços, mínimo, máximo e regra para seguir sua operação.</p>}

      <div className="mt-4 space-y-4">
        {value.map((group, groupIndex) => (
          <article key={`${groupIndex}-${group.name}`} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Grupo {groupIndex + 1}</p>
              <Button type="button" size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30" onClick={() => onChange(value.filter((_, index) => index !== groupIndex))}>Remover grupo</Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Nome do grupo"><Input placeholder="Ex.: Sabores" value={group.name} onChange={(event) => updateGroup(groupIndex, { name: event.target.value })} /></FormField>
              <FormField label="Tipo de escolha">
                <Select value={group.selectionType} onChange={(event) => {
                  const selectionType = event.target.value as ProductOptionGroupDraft["selectionType"];
                  updateGroup(groupIndex, selectionType === "SINGLE"
                    ? { selectionType, maxSelections: "1", minSelections: Number(group.minSelections) > 1 ? "1" : group.minSelections }
                    : { selectionType });
                }}>
                  <option value="SINGLE">Uma opção</option>
                  <option value="MULTIPLE">Múltiplas opções</option>
                </Select>
              </FormField>
            </div>
            <div className="mt-3"><FormField label="Orientação para o cliente (opcional)"><Textarea rows={2} placeholder="Ex.: escolha até 2 sabores" value={group.description} onChange={(event) => updateGroup(groupIndex, { description: event.target.value })} /></FormField></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <FormField label="Mínimo"><Input type="number" min="0" max="30" value={group.minSelections} onChange={(event) => updateGroup(groupIndex, { minSelections: event.target.value })} /></FormField>
              <FormField label="Máximo"><Input type="number" min="1" max="30" value={group.maxSelections} disabled={group.selectionType === "SINGLE"} onChange={(event) => updateGroup(groupIndex, { maxSelections: event.target.value })} /></FormField>
              <FormField label="Como cobrar">
                <Select value={group.pricingRule} onChange={(event) => updateGroup(groupIndex, { pricingRule: event.target.value as ProductOptionGroupDraft["pricingRule"] })}>
                  <option value="SUM">Somar adicionais</option>
                  <option value="HIGHEST">Maior adicional</option>
                  <option value="AVERAGE">Média dos adicionais</option>
                </Select>
              </FormField>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-black text-slate-800 dark:text-slate-200">Opções disponíveis</p><Button type="button" size="sm" variant="outline" onClick={() => updateGroup(groupIndex, { options: [...group.options, { name: "", priceDelta: "0" }] })}>+ Opção</Button></div>
              <div className="space-y-2">
                {group.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="grid gap-2 sm:grid-cols-[1fr_126px_auto]">
                    <Input placeholder="Ex.: Calabresa" value={option.name} onChange={(event) => updateOption(groupIndex, optionIndex, { name: event.target.value })} />
                    <Input type="number" step="0.01" placeholder="Acréscimo" value={option.priceDelta} onChange={(event) => updateOption(groupIndex, optionIndex, { priceDelta: event.target.value })} />
                    <Button type="button" size="sm" variant="ghost" disabled={group.options.length === 1} onClick={() => updateGroup(groupIndex, { options: group.options.filter((_, index) => index !== optionIndex) })}>Remover</Button>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
