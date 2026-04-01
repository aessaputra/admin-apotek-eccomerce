import { describe, expect, it, vi } from "vitest";
import {
  PAYMENT_COLORS,
  STATUS_COLORS,
  TRANSITION_RULES,
  getPaymentOptions,
  getStatusOptions,
} from "../orders";

describe("order constants", () => {
  it("maps known order statuses to UI colors", () => {
    expect(STATUS_COLORS).toMatchObject({
      pending: "orange",
      awaiting_shipment: "gold",
      delivered: "green",
      cancelled: "red",
    });
  });

  it("maps payment statuses to UI colors", () => {
    expect(PAYMENT_COLORS).toMatchObject({
      settlement: "green",
      deny: "red",
      partial_chargeback: "volcano",
    });
  });

  it("builds translated status filter options in admin order", () => {
    const translate = vi.fn((key: string) => `translated:${key}`);

    const result = getStatusOptions(translate);

    expect(result).toEqual([
      { value: "pending", label: "translated:orderStatus.pending" },
      { value: "processing", label: "translated:orderStatus.processing" },
      { value: "awaiting_shipment", label: "translated:orderStatus.awaiting_shipment" },
      { value: "shipped", label: "translated:orderStatus.shipped" },
      { value: "delivered", label: "translated:orderStatus.delivered" },
      { value: "cancelled", label: "translated:orderStatus.cancelled" },
    ]);
    expect(translate).toHaveBeenCalledTimes(6);
  });

  it("builds translated payment filter options in admin order", () => {
    const translate = vi.fn((key: string) => `translated:${key}`);

    const result = getPaymentOptions(translate);

    expect(result).toEqual([
      { value: "pending", label: "translated:paymentStatus.pending" },
      { value: "authorize", label: "translated:paymentStatus.authorize" },
      { value: "settlement", label: "translated:paymentStatus.settlement" },
      { value: "deny", label: "translated:paymentStatus.deny" },
      { value: "cancel", label: "translated:paymentStatus.cancel" },
      { value: "expire", label: "translated:paymentStatus.expire" },
      { value: "refund", label: "translated:paymentStatus.refund" },
      { value: "partial_refund", label: "translated:paymentStatus.partial_refund" },
      { value: "chargeback", label: "translated:paymentStatus.chargeback" },
      { value: "partial_chargeback", label: "translated:paymentStatus.partial_chargeback" },
    ]);
    expect(translate).toHaveBeenCalledTimes(10);
  });

  it("keeps only the allowed admin status transitions", () => {
    expect(TRANSITION_RULES).toEqual({
      pending: ["processing", "cancelled"],
      paid: ["awaiting_shipment", "processing", "cancelled"],
      processing: ["shipped", "cancelled"],
      awaiting_shipment: ["processing", "shipped", "cancelled"],
      shipped: ["delivered"],
    });
    expect(TRANSITION_RULES.delivered).toBeUndefined();
    expect(TRANSITION_RULES.cancelled).toBeUndefined();
  });
});
