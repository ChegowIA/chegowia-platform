import type { OrderItemOptionSelection, ProductOptionGroup, ProductOptionSelectionInput } from "@/lib/types";

export type ProductOptionSelectionState = Record<string, string[]>;

export function groupSelectionIds(
  state: ProductOptionSelectionState,
  groupId: string,
) {
  return state[groupId] ?? [];
}

export function optionSelectionsFromState(
  groups: ProductOptionGroup[] | undefined,
  state: ProductOptionSelectionState,
): ProductOptionSelectionInput[] {
  return (groups ?? [])
    .map((group) => ({ groupId: group.id, optionIds: [...groupSelectionIds(state, group.id)].sort() }))
    .filter((selection) => selection.optionIds.length > 0)
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
}

export function optionGroupsTotal(
  groups: ProductOptionGroup[] | undefined,
  state: ProductOptionSelectionState,
) {
  const total = (groups ?? []).reduce((sum, group) => sum + optionGroupPriceDelta(group, groupSelectionIds(state, group.id)), 0);
  return roundCurrency(total);
}

export function optionGroupPriceDelta(group: ProductOptionGroup, selectedIds: string[]) {
  const selected = group.options.filter((option) => selectedIds.includes(option.id));
  if (!selected.length) return 0;
  const deltas = selected.map((option) => Number(option.priceDelta));
  if (group.pricingRule === "HIGHEST") return Math.max(...deltas);
  if (group.pricingRule === "AVERAGE") return roundCurrency(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length);
  return roundCurrency(deltas.reduce((sum, delta) => sum + delta, 0));
}

export function optionSelectionsAreValid(
  groups: ProductOptionGroup[] | undefined,
  state: ProductOptionSelectionState,
) {
  return (groups ?? []).every((group) => {
    const selected = groupSelectionIds(state, group.id);
    return selected.length >= Number(group.minSelections) && selected.length <= Number(group.maxSelections);
  });
}

export function optionSelectionsLabel(
  groups: ProductOptionGroup[] | undefined,
  state: ProductOptionSelectionState,
) {
  return (groups ?? [])
    .map((group) => {
      const names = group.options
        .filter((option) => groupSelectionIds(state, group.id).includes(option.id))
        .map((option) => option.name);
      return names.length ? `${group.name}: ${names.join(", ")}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

export function storedOptionSelectionsLabel(selections: OrderItemOptionSelection[] | null | undefined) {
  return (selections ?? [])
    .map((group) => {
      const names = group.options.map((option) => option.name).filter(Boolean);
      return names.length ? `${group.groupName}: ${names.join(", ")}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

export function groupChoiceInstruction(group: ProductOptionGroup) {
  const min = Number(group.minSelections);
  const max = Number(group.maxSelections);
  if (min === max) return `Escolha ${min} ${min === 1 ? "opção" : "opções"}`;
  if (min > 0) return `Escolha de ${min} a ${max} opções`;
  return `Opcional · até ${max} ${max === 1 ? "opção" : "opções"}`;
}

export function groupPricingHint(group: ProductOptionGroup) {
  if (group.pricingRule === "HIGHEST") return "Ao combinar opções, vale o maior adicional.";
  if (group.pricingRule === "AVERAGE") return "Ao combinar opções, vale a média dos adicionais.";
  return null;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
