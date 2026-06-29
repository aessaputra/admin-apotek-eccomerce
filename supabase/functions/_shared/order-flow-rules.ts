type ProviderSyncForStatusTransitionArgs = {
  targetStatus: string;
  biteshipOrderId?: string | null;
  waybillSource?: "system" | "manual" | null;
};

const PROVIDER_OWNED_SHIPPING_STATUSES = new Set([
  "shipped",
  "in_transit",
  "delivered",
]);

const PAYMENT_REQUIRED_ORDER_STATUSES = new Set([
  "processing",
  "awaiting_shipment",
  "shipped",
  "in_transit",
  "delivered",
]);

type BiteshipFulfillmentQueueArgs = {
  paymentStatus?: string | null;
  status?: string | null;
  biteshipOrderId?: string | null;
  courierCode?: string | null;
  existingNeedsBiteship?: boolean;
  pendingBiteshipOrderId?: string | null;
};

type SettlementSideEffectFlags = {
  needsCartCleanup: boolean;
  needsStock: boolean;
  needsBiteship: boolean;
};

export function requiresBiteshipSyncForProviderStatusTransition(
  args: ProviderSyncForStatusTransitionArgs,
): boolean {
  if (!Boolean(args.biteshipOrderId)) {
    return false;
  }

  if (args.waybillSource === "manual") {
    return false;
  }

  return (
    PROVIDER_OWNED_SHIPPING_STATUSES.has(args.targetStatus)
  );
}

export function shouldQueueBiteshipFulfillment(
  args: BiteshipFulfillmentQueueArgs,
): boolean {
  return (
    args.status === "awaiting_shipment" &&
    Boolean(args.courierCode) &&
    !args.biteshipOrderId
  );
}

export function requiresSettledPaymentForOrderStatus(status: string): boolean {
  return PAYMENT_REQUIRED_ORDER_STATUSES.has(status);
}

export function canApplyOrderStatusForPaymentStatus(args: {
  targetStatus: string;
  paymentStatus?: string | null;
}): boolean {
  return (
    !requiresSettledPaymentForOrderStatus(args.targetStatus) ||
    args.paymentStatus === "settlement"
  );
}

export function canConfirmReceivedOrder(args: {
  orderStatus?: string | null;
  paymentStatus?: string | null;
}): boolean {
  return args.orderStatus === "delivered" && args.paymentStatus === "settlement";
}

export function deriveSettlementSideEffectFlags(
  args: BiteshipFulfillmentQueueArgs,
): SettlementSideEffectFlags | null {
  if (args.paymentStatus !== "settlement") {
    return null;
  }

  return {
    needsCartCleanup: true,
    needsStock: true,
    needsBiteship:
      Boolean(args.existingNeedsBiteship) ||
      Boolean(args.pendingBiteshipOrderId) ||
      shouldQueueBiteshipFulfillment(args),
  };
}
