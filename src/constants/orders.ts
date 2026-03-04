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
  unpaid: "default",
  pending: "orange",
  success: "green",
  failed: "red",
};

export function getStatusOptions(translate: (key: string) => string) {
  return [
    { value: "pending", label: translate("orderStatus.pending") },
    { value: "processing", label: translate("orderStatus.processing") },
    { value: "paid", label: translate("orderStatus.paid") },
    { value: "awaiting_shipment", label: translate("orderStatus.awaiting_shipment") },
    { value: "shipped", label: translate("orderStatus.shipped") },
    { value: "delivered", label: translate("orderStatus.delivered") },
    { value: "cancelled", label: translate("orderStatus.cancelled") },
  ];
}

export function getPaymentOptions(translate: (key: string) => string) {
  return [
    { value: "unpaid", label: translate("paymentStatus.unpaid") },
    { value: "pending", label: translate("paymentStatus.pending") },
    { value: "success", label: translate("paymentStatus.success") },
    { value: "failed", label: translate("paymentStatus.failed") },
  ];
}
