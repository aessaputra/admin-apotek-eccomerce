import { describe, expect, it } from "vitest";

import {
  deriveSettlementSideEffectFlags,
  requiresBiteshipSyncForProviderStatusTransition,
  shouldQueueBiteshipFulfillment,
} from "../order-flow-rules.ts";

describe("order flow rules", () => {
  it("requires provider sync when Biteship-managed shipments enter shipped without a manual override", () => {
    expect(
      requiresBiteshipSyncForProviderStatusTransition({
        targetStatus: "shipped",
        biteshipOrderId: "BT-1",
        waybillSource: null,
      }),
    ).toBe(true);
  });

  it("allows explicit manual overrides for Biteship-managed shipped transitions", () => {
    expect(
      requiresBiteshipSyncForProviderStatusTransition({
        targetStatus: "shipped",
        biteshipOrderId: "BT-1",
        waybillSource: "manual",
      }),
    ).toBe(false);
  });

  it("does not require provider sync for non-shipped transitions", () => {
    expect(
      requiresBiteshipSyncForProviderStatusTransition({
        targetStatus: "cancelled",
        biteshipOrderId: "BT-1",
        waybillSource: null,
      }),
    ).toBe(false);

    expect(
      requiresBiteshipSyncForProviderStatusTransition({
        targetStatus: "shipped",
        biteshipOrderId: null,
        waybillSource: null,
      }),
    ).toBe(false);
  });

  it("keeps downstream Biteship shipping progress sync-driven", () => {
    expect(
      requiresBiteshipSyncForProviderStatusTransition({
        targetStatus: "in_transit",
        biteshipOrderId: "BT-1",
        waybillSource: "system",
      }),
    ).toBe(true);

    expect(
      requiresBiteshipSyncForProviderStatusTransition({
        targetStatus: "delivered",
        biteshipOrderId: "BT-1",
        waybillSource: "system",
      }),
    ).toBe(true);

    expect(
      requiresBiteshipSyncForProviderStatusTransition({
        targetStatus: "in_transit",
        biteshipOrderId: null,
        waybillSource: null,
      }),
    ).toBe(false);
  });

  it("queues Biteship fulfillment only for awaiting_shipment orders without a provider order yet", () => {
    expect(
      shouldQueueBiteshipFulfillment({
        status: "awaiting_shipment",
        courierCode: "jne",
        biteshipOrderId: null,
      }),
    ).toBe(true);

    expect(
      shouldQueueBiteshipFulfillment({
        status: "processing",
        courierCode: "jne",
        biteshipOrderId: null,
      }),
    ).toBe(false);

    expect(
      shouldQueueBiteshipFulfillment({
        status: "awaiting_shipment",
        courierCode: "jne",
        biteshipOrderId: "BT-1",
      }),
    ).toBe(false);
  });

  it("derives settlement side effects so awaiting_shipment orders re-queue Biteship fulfillment", () => {
    expect(
      deriveSettlementSideEffectFlags({
        paymentStatus: "settlement",
        status: "awaiting_shipment",
        courierCode: "jne",
        biteshipOrderId: null,
      }),
    ).toEqual({
      needsCartCleanup: true,
      needsStock: true,
      needsBiteship: true,
    });

    expect(
      deriveSettlementSideEffectFlags({
        paymentStatus: "settlement",
        status: "processing",
        courierCode: "jne",
        biteshipOrderId: null,
        pendingBiteshipOrderId: "BT-pending",
      }),
    ).toEqual({
      needsCartCleanup: true,
      needsStock: true,
      needsBiteship: true,
    });

    expect(
      deriveSettlementSideEffectFlags({
        paymentStatus: "pending",
        status: "awaiting_shipment",
        courierCode: "jne",
        biteshipOrderId: null,
      }),
    ).toBeNull();
  });
});
