export const STATUS_COLORS: Record<string, string> = {
  pending: "orange",
  processing: "blue",
  awaiting_shipment: "gold",
  shipped: "cyan",
  in_transit: "geekblue",
  delivered: "green",
  cancelled: "red",
};

export const PAYMENT_COLORS: Record<string, string> = {
  pending: "orange",
  settlement: "green",
  authorize: "blue",
  deny: "red",
  cancel: "red",
  expire: "gold",
  refund: "purple",
  partial_refund: "purple",
  chargeback: "volcano",
  partial_chargeback: "volcano",
};

export function getStatusOptions(translate: (key: string) => string) {
  return [
    { value: "pending", label: translate("orderStatus.pending") },
    { value: "processing", label: translate("orderStatus.processing") },
    { value: "awaiting_shipment", label: translate("orderStatus.awaiting_shipment") },
    { value: "shipped", label: translate("orderStatus.shipped") },
    { value: "in_transit", label: translate("orderStatus.in_transit") },
    { value: "delivered", label: translate("orderStatus.delivered") },
    { value: "cancelled", label: translate("orderStatus.cancelled") },
  ];
}

export function getPaymentOptions(translate: (key: string) => string) {
  return [
    { value: "pending", label: translate("paymentStatus.pending") },
    { value: "authorize", label: translate("paymentStatus.authorize") },
    { value: "settlement", label: translate("paymentStatus.settlement") },
    { value: "deny", label: translate("paymentStatus.deny") },
    { value: "cancel", label: translate("paymentStatus.cancel") },
    { value: "expire", label: translate("paymentStatus.expire") },
    { value: "refund", label: translate("paymentStatus.refund") },
    { value: "partial_refund", label: translate("paymentStatus.partial_refund") },
    { value: "chargeback", label: translate("paymentStatus.chargeback") },
    { value: "partial_chargeback", label: translate("paymentStatus.partial_chargeback") },
  ];
}

// Order status transition rules matching order-manager Edge Function
// These define valid state transitions for admin UI
// The active fulfillment lifecycle is: processing -> awaiting_shipment -> shipped -> in_transit -> delivered.
export const TRANSITION_RULES: Record<string, string[]> = {
  pending: ["processing", "cancelled"],
  processing: ["awaiting_shipment", "cancelled"],
  awaiting_shipment: ["shipped", "cancelled"],
  shipped: ["in_transit", "delivered"],
  in_transit: ["delivered"],
};
