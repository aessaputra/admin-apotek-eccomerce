import type {
  MidtransStatusMapping,
  MidtransStatusLike,
  MidtransStatusResponse,
  MidtransWebhookPayload,
  Order,
  AuthUser,
  SnapPayload,
  SnapItemDetail,
  PaymentStatus,
} from "./types.ts";

const MIDTRANS_PAYMENT_TYPE_ALLOWLIST = new Set([
  "credit_card",
  "bank_transfer",
  "echannel",
  "permata_va",
  "bca_va",
  "bni_va",
  "bri_va",
  "cimb_va",
  "danamon_va",
  "bsi_va",
  "other_va",
  "gopay",
  "shopeepay",
  "ovo",
  "dana",
  "qris",
  "other_qris",
  "cstore",
  "akulaku",
  "kredivo",
  "indomaret",
  "alfamart",
  "other",
]);

const STALE_PAYMENT_STATUS_MAP: Record<PaymentStatus, PaymentStatus[]> = {
  pending: [
    "authorize",
    "settlement",
    "deny",
    "cancel",
    "expire",
    "refund",
    "partial_refund",
    "chargeback",
    "partial_chargeback",
  ],
  authorize: [
    "settlement",
    "deny",
    "cancel",
    "expire",
    "refund",
    "partial_refund",
    "chargeback",
    "partial_chargeback",
  ],
  settlement: ["refund", "partial_refund", "chargeback", "partial_chargeback"],
  deny: [
    "settlement",
    "refund",
    "partial_refund",
    "chargeback",
    "partial_chargeback",
  ],
  cancel: [
    "settlement",
    "refund",
    "partial_refund",
    "chargeback",
    "partial_chargeback",
  ],
  expire: [
    "settlement",
    "refund",
    "partial_refund",
    "chargeback",
    "partial_chargeback",
  ],
  refund: ["partial_refund", "chargeback", "partial_chargeback"],
  partial_refund: [],
  chargeback: ["partial_chargeback"],
  partial_chargeback: [],
};

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
};

export const verifyMidtransSignature = async (
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
  providedSignature: string,
): Promise<boolean> => {
  const rawString = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(rawString);
  const hashBuffer = await crypto.subtle.digest("SHA-512", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const generatedSignature = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return generatedSignature === providedSignature;
};

export const verifyMidtransTransaction = async (
  orderId: string,
  serverKey: string,
): Promise<MidtransStatusResponse> => {
  const isProduction = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
  const baseUrl = isProduction
    ? "https://api.midtrans.com/v2"
    : "https://api.sandbox.midtrans.com/v2";

  const response = await fetch(`${baseUrl}/${orderId}/status`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${serverKey}:`)}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Midtrans status check failed: ${data.status_message || response.statusText}`,
    );
  }

  return data as MidtransStatusResponse;
};

export const mapMidtransStatus = (
  transactionStatus: string,
  fraudStatus: string,
  currentPaymentStatus: MidtransStatusMapping["newPaymentStatus"],
  currentOrderStatus: string,
): MidtransStatusMapping => {
  let newPaymentStatus = currentPaymentStatus;
  let newOrderStatus = currentOrderStatus;
  let shouldReduceStock = false;

  if (transactionStatus === "capture") {
    if (fraudStatus === "deny") {
      newPaymentStatus = "deny";
      newOrderStatus = "cancelled";
    } else if (fraudStatus === "challenge") {
      newPaymentStatus = "pending";
    } else if (fraudStatus === "accept") {
      newPaymentStatus = "settlement";
      newOrderStatus = "awaiting_shipment";
      shouldReduceStock = currentPaymentStatus !== "settlement";
    }
  } else if (transactionStatus === "settlement") {
    newPaymentStatus = "settlement";
    newOrderStatus = "awaiting_shipment";
    shouldReduceStock = currentPaymentStatus !== "settlement";
  } else if (["cancel", "deny", "expire"].includes(transactionStatus)) {
    newPaymentStatus =
      transactionStatus as MidtransStatusMapping["newPaymentStatus"];
    newOrderStatus = "cancelled";
  } else if (transactionStatus === "refund") {
    newPaymentStatus = "refund";
  } else if (transactionStatus === "partial_refund") {
    newPaymentStatus = "partial_refund";
  } else if (transactionStatus === "chargeback") {
    newPaymentStatus = "chargeback";
  } else if (transactionStatus === "partial_chargeback") {
    newPaymentStatus = "partial_chargeback";
  } else if (transactionStatus === "authorize") {
    newPaymentStatus = "authorize";
  } else if (transactionStatus === "pending") {
    newPaymentStatus = "pending";
  } else if (transactionStatus === "failure") {
    newPaymentStatus = "deny";
    newOrderStatus = "cancelled";
  }

  return { newPaymentStatus, newOrderStatus, shouldReduceStock };
};

export const isConfirmedMidtransSuccess = (
  status: MidtransStatusLike,
): boolean => {
  const transactionStatus = status.transaction_status;
  const fraudStatus = status.fraud_status?.toLowerCase() ?? "";
  const statusCode = status.status_code ?? "";

  if (statusCode !== "200") {
    return false;
  }

  if (transactionStatus === "settlement") {
    return true;
  }

  return transactionStatus === "capture" && fraudStatus === "accept";
};

export const isIgnorableMidtransNoop = (
  currentPaymentStatus: PaymentStatus | null | undefined,
  nextPaymentStatus: PaymentStatus,
): boolean => {
  if (!currentPaymentStatus) {
    return false;
  }

  if (currentPaymentStatus === nextPaymentStatus) {
    return true;
  }

  return STALE_PAYMENT_STATUS_MAP[nextPaymentStatus].includes(
    currentPaymentStatus,
  );
};

export const normalizeMidtransPaymentType = (
  value: string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }

  return MIDTRANS_PAYMENT_TYPE_ALLOWLIST.has(value) ? value : "other";
};

export const normalizeMidtransCurrency = (
  value: string | null | undefined,
): string | null => {
  const normalizedValue = value?.trim().toUpperCase();
  return normalizedValue ? normalizedValue : null;
};

export const getRequiredMidtransCurrency = (
  primaryValue: string | null | undefined,
  secondaryValue: string | null | undefined,
  contextLabel: string,
  orderId: string,
): string => {
  const currency =
    normalizeMidtransCurrency(primaryValue) ??
    normalizeMidtransCurrency(secondaryValue);

  if (!currency) {
    throw new Error(
      `Missing currency in ${contextLabel} for order ${orderId}. Midtrans data must include a valid currency before payment data can be persisted.`,
    );
  }

  return currency;
};

export const assertMidtransCurrencyConsistency = (
  verifiedCurrency: string | null | undefined,
  payloadCurrency: string | null | undefined,
  orderId: string,
): string => {
  const normalizedVerifiedCurrency = normalizeMidtransCurrency(verifiedCurrency);
  const normalizedPayloadCurrency = normalizeMidtransCurrency(payloadCurrency);

  if (
    normalizedVerifiedCurrency &&
    normalizedPayloadCurrency &&
    normalizedVerifiedCurrency !== normalizedPayloadCurrency
  ) {
    throw new Error(
      `Currency mismatch for order ${orderId}. Verified Midtrans status uses ${normalizedVerifiedCurrency} while payload uses ${normalizedPayloadCurrency}.`,
    );
  }

  return getRequiredMidtransCurrency(
    normalizedVerifiedCurrency,
    normalizedPayloadCurrency,
    "verified Midtrans status",
    orderId,
  );
};

export const pickMidtransTimestamp = (
  value: string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
};

export const getCanonicalMidtransPaidAt = (
  existingPaidAt: string | null | undefined,
  nextPaymentStatus: PaymentStatus,
  settlementTime: string | null | undefined,
): string | null => {
  if (existingPaidAt) {
    return existingPaidAt;
  }

  if (nextPaymentStatus !== "settlement") {
    return null;
  }

  return pickMidtransTimestamp(settlementTime) ?? new Date().toISOString();
};

export const buildMidtransPaymentRecord = ({
  order,
  payload,
  verifiedStatus,
  nextPaymentStatus,
  existingPaidAt,
}: {
  order: Order;
  payload?: MidtransWebhookPayload | null;
  verifiedStatus: MidtransStatusResponse;
  nextPaymentStatus: PaymentStatus;
  existingPaidAt: string | null | undefined;
}) => {
  const orderReference =
    payload?.order_id || verifiedStatus.order_id || order.midtrans_order_id || order.id;
  const currency = assertMidtransCurrencyConsistency(
    verifiedStatus.currency,
    payload?.currency,
    orderReference,
  );
  const paymentType = normalizeMidtransPaymentType(
    verifiedStatus.payment_type || payload?.payment_type || order.payment_type,
  );
  const settlementTime = pickMidtransTimestamp(
    verifiedStatus.settlement_time || payload?.settlement_time,
  );

  return {
    order_id: order.id,
    user_id: order.user_id ?? null,
    checkout_idempotency_key: order.checkout_idempotency_key ?? null,
    midtrans_order_id: payload?.order_id || order.midtrans_order_id,
    midtrans_transaction_id:
      verifiedStatus.transaction_id || payload?.transaction_id || null,
    status: nextPaymentStatus,
    payment_type: paymentType,
    transaction_status:
      verifiedStatus.transaction_status || payload?.transaction_status || null,
    fraud_status: verifiedStatus.fraud_status || payload?.fraud_status || null,
    status_code: verifiedStatus.status_code || payload?.status_code || null,
    status_message:
      verifiedStatus.status_message || payload?.status_message || null,
    currency,
    gross_amount: Number.parseFloat(
      String(verifiedStatus.gross_amount || payload?.gross_amount || 0),
    ),
    signature_key: payload?.signature_key,
    merchant_id: verifiedStatus.merchant_id || payload?.merchant_id || null,
    transaction_time: pickMidtransTimestamp(
      verifiedStatus.transaction_time || payload?.transaction_time,
    ),
    settlement_time: settlementTime,
    expiry_time: pickMidtransTimestamp(
      verifiedStatus.expiry_time || payload?.expiry_time,
    ),
    paid_at: getCanonicalMidtransPaidAt(
      existingPaidAt,
      nextPaymentStatus,
      settlementTime,
    ),
    payment_code: verifiedStatus.payment_code || payload?.payment_code || null,
    store: verifiedStatus.store || payload?.store || null,
    va_numbers: verifiedStatus.va_numbers || payload?.va_numbers || [],
    biller_code: verifiedStatus.biller_code || payload?.biller_code || null,
    bill_key: verifiedStatus.bill_key || payload?.bill_key || null,
    bank: verifiedStatus.bank || payload?.bank || null,
    acquirer: verifiedStatus.acquirer || payload?.acquirer || null,
    issuer: verifiedStatus.issuer || payload?.issuer || null,
    card_type: verifiedStatus.card_type || payload?.card_type || null,
    masked_card: verifiedStatus.masked_card || payload?.masked_card || null,
    approval_code:
      verifiedStatus.approval_code || payload?.approval_code || null,
    eci: verifiedStatus.eci || payload?.eci || null,
    channel_response_code:
      verifiedStatus.channel_response_code || payload?.channel_response_code || null,
    channel_response_message:
      verifiedStatus.channel_response_message ||
      payload?.channel_response_message ||
      null,
    redirect_url: verifiedStatus.redirect_url || payload?.redirect_url || null,
    raw_notification: payload ?? verifiedStatus,
  };
};

export const calculateMidtransGrossAmount = (order: Order): number => {
  let grossAmount = 0;

  for (const item of order.order_items || []) {
    const price = Math.round(Number(item.price_at_purchase));
    const quantity = Number(item.quantity);
    grossAmount += price * quantity;
  }

  if (order.shipping_cost && Number(order.shipping_cost) > 0) {
    grossAmount += Math.round(Number(order.shipping_cost));
  }

  return grossAmount;
};

export const buildSnapPayload = (order: Order, user: AuthUser): SnapPayload => {
  if (!order.midtrans_order_id) {
    throw new Error("Order does not have midtrans_order_id");
  }

  const calculatedGrossAmount = calculateMidtransGrossAmount(order);

  const itemDetails: SnapItemDetail[] = (order.order_items || []).map(
    (item, index) => {
      const price = Math.round(Number(item.price_at_purchase));
      const quantity = Number(item.quantity);

      return {
        id: item.product_id || `ITEM-${index + 1}`,
        price: price,
        quantity: quantity,
        name: item.products?.name?.slice(0, 50) || "Product",
        category: item.products?.categories?.name?.slice(0, 50) || "General",
      };
    },
  );

  if (order.shipping_cost && Number(order.shipping_cost) > 0) {
    const shippingPrice = Math.round(Number(order.shipping_cost));
    itemDetails.push({
      id: "SHIPPING-FEE",
      price: shippingPrice,
      quantity: 1,
      name: "Ongkos Kirim",
      category: "Shipping",
    });
  }

  const customerDetails = {
    first_name: order.profiles?.full_name?.split(" ")[0] || "Customer",
    last_name: order.profiles?.full_name?.split(" ").slice(1).join(" ") || "",
    email: user.email || "",
    phone: order.profiles?.phone_number || "",
  };

  return {
    transaction_details: {
      order_id: order.midtrans_order_id,
      gross_amount: calculatedGrossAmount,
    },
    item_details: itemDetails,
    customer_details: customerDetails,
  };
};
