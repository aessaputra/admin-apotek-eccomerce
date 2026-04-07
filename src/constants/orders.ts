export const STATUS_COLORS: Record<string, string> = {
  pending: "orange",
  processing: "blue",
  paid: "green",
  awaiting_shipment: "gold",
  shipped: "cyan",
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
    { value: "paid", label: translate("orderStatus.paid") },
    { value: "processing", label: translate("orderStatus.processing") },
    { value: "awaiting_shipment", label: translate("orderStatus.awaiting_shipment") },
    { value: "shipped", label: translate("orderStatus.shipped") },
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
// Note: 'paid' is included as a SOURCE state for legacy orders,
// but is NOT a target state (modern flow uses awaiting_shipment)
export const TRANSITION_RULES: Record<string, string[]> = {
  pending: ["processing", "cancelled"],
  paid: ["awaiting_shipment", "processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  awaiting_shipment: ["processing", "shipped", "cancelled"],
  shipped: ["delivered"],
};