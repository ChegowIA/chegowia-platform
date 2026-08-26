import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProductOptionSelectionInput } from "@/lib/types";

export interface CartItem {
  key: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  variationId?: string;
  variationName?: string;
  addonIds?: string[];
  addonsLabel?: string;
  optionSelections?: ProductOptionSelectionInput[];
  optionSelectionsLabel?: string;
  notes?: string;
}

interface CartState {
  companySlug: string | null;
  items: CartItem[];
  setCompany: (slug: string) => void;
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      companySlug: null,
      items: [],
      setCompany: (slug) => {
        if (get().companySlug && get().companySlug !== slug) set({ items: [] });
        set({ companySlug: slug });
      },
      addItem: (item) =>
        set((state) => {
          const existing = state.items.find((i) => i.key === item.key);
          if (existing) {
            return {
              items: state.items.map((i) => (i.key === item.key ? { ...i, quantity: i.quantity + item.quantity } : i)),
            };
          }
          return { items: [...state.items, item] };
        }),
      removeItem: (key) => set((state) => ({ items: state.items.filter((i) => i.key !== key) })),
      updateQuantity: (key, quantity) =>
        set((state) => ({
          items: quantity <= 0 ? state.items.filter((i) => i.key !== key) : state.items.map((i) => (i.key === key ? { ...i, quantity } : i)),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: "chegowia-cart" },
  ),
);

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}
