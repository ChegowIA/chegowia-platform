"use client";

import { formatCurrency } from "@/lib/format";
import {
  groupChoiceInstruction,
  groupPricingHint,
  groupSelectionIds,
  type ProductOptionSelectionState,
} from "@/lib/product-options";
import type { ProductOptionGroup } from "@/lib/types";

type ProductOptionGroupsProps = {
  groups?: ProductOptionGroup[];
  selections: ProductOptionSelectionState;
  onChange: (groupId: string, optionIds: string[]) => void;
  namePrefix: string;
  onLimitReached?: (message: string) => void;
};

/**
 * Seleção genérica de montagem usada tanto no delivery quanto no QR de mesa.
 * A interface nasce dos limites cadastrados no produto, portanto não possui
 * nenhuma regra fixa para pizza, hambúrguer ou outro tipo de alimento.
 */
export function ProductOptionGroups({
  groups = [],
  selections,
  onChange,
  namePrefix,
  onLimitReached,
}: ProductOptionGroupsProps) {
  if (!groups.length) return null;

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const selectedIds = groupSelectionIds(selections, group.id);
        const isSingle = group.selectionType === "SINGLE" || Number(group.maxSelections) === 1;
        const pricingHint = groupPricingHint(group);

        function toggleOption(optionId: string) {
          if (isSingle) {
            onChange(group.id, [optionId]);
            return;
          }
          if (selectedIds.includes(optionId)) {
            onChange(group.id, selectedIds.filter((id) => id !== optionId));
            return;
          }
          if (selectedIds.length >= Number(group.maxSelections)) {
            onLimitReached?.(`${group.name}: escolha no máximo ${group.maxSelections} ${Number(group.maxSelections) === 1 ? "opção" : "opções"}.`);
            return;
          }
          onChange(group.id, [...selectedIds, optionId]);
        }

        return (
          <section key={group.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/30">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{group.name}</h3>
                {group.description && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{group.description}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${Number(group.minSelections) > 0 ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                {groupChoiceInstruction(group)}
              </span>
            </div>
            {pricingHint && <p className="mb-3 rounded-xl bg-white px-3 py-2 text-[11px] font-semibold leading-5 text-slate-500 dark:bg-slate-900 dark:text-slate-400">{pricingHint}</p>}
            <div className="space-y-2">
              {group.options.map((option) => {
                const selected = selectedIds.includes(option.id);
                const delta = Number(option.priceDelta);
                return (
                  <label key={option.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-3 text-sm transition ${selected ? "border-brand-300 bg-brand-50 text-brand-950 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-100" : "border-slate-200 bg-white text-slate-700 hover:border-brand-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"}`}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <input
                        type={isSingle ? "radio" : "checkbox"}
                        name={`${namePrefix}-${group.id}`}
                        checked={selected}
                        onChange={() => toggleOption(option.id)}
                      />
                      <span className="font-semibold">{option.name}</span>
                    </span>
                    {delta !== 0 && <span className="shrink-0 text-xs font-black text-brand-700 dark:text-brand-300">{delta > 0 ? "+" : ""}{formatCurrency(delta)}</span>}
                  </label>
                );
              })}
            </div>
            {Number(group.minSelections) === 0 && isSingle && selectedIds.length > 0 && (
              <button type="button" className="mt-2 text-xs font-bold text-slate-500 hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-300" onClick={() => onChange(group.id, [])}>
                Limpar escolha
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
