import { OrderFulfillmentType, OrderStatus } from "@chegowia/shared";

export function isPickupOrder(order: { fulfillmentType?: OrderFulfillmentType }) {
  return order.fulfillmentType === OrderFulfillmentType.PICKUP;
}

export function orderStatusLabel(status: OrderStatus, pickup = false) {
  if (pickup && status === OrderStatus.PRONTO) return "Pronto para retirada";
  if (pickup && status === OrderStatus.ENTREGUE) return "Retirado pelo cliente";
  return status.replaceAll("_", " ");
}
