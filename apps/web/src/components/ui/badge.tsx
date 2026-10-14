import clsx from "clsx";
import { OrderFulfillmentType, OrderStatus } from "@chegowia/shared";
import { orderStatusLabel } from "@/lib/order-fulfillment";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-300",
  info: "border-accent-200 bg-accent-50 text-accent-800 dark:border-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
  brand: "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-900/40 dark:text-brand-300",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE_CLASSES[tone])}>
      {children}
    </span>
  );
}

const ORDER_STATUS_TONE: Record<string, Tone> = {
  RECEBIDO: "info",
  CONFIRMADO: "info",
  EM_PREPARO: "warning",
  PRONTO: "brand",
  SAIU_PARA_ENTREGA: "brand",
  ENTREGUE: "success",
  CANCELADO: "danger",
};

export function OrderStatusBadge({ status, fulfillmentType }: { status: OrderStatus; fulfillmentType?: OrderFulfillmentType }) {
  return <Badge tone={ORDER_STATUS_TONE[status] ?? "neutral"}>{orderStatusLabel(status, fulfillmentType === OrderFulfillmentType.PICKUP)}</Badge>;
}
