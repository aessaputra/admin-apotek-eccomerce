import type {
  MidtransStatusMapping,
  MidtransStatusLike,
  MidtransStatusResponse,
  Order,
  AuthUser,
  SnapPayload,
  SnapItemDetail,
  PaymentStatus,
} from "./types.ts";

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
