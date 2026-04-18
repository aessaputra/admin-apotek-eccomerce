import { describe, expect, it } from "vitest";

import {
  buildShipmentRestorePayload,
  createEmptyShipmentSnapshot,
  runMutationWithRollback,
  toShipmentSnapshot,
} from "../order-manager-mutation.ts";

describe("order-manager mutation helpers", () => {
  it("creates an empty shipment snapshot when no row exists", () => {
    expect(toShipmentSnapshot(null)).toEqual(createEmptyShipmentSnapshot());
  });

  it("normalizes a live shipment row into a restoreable snapshot", () => {
    expect(
      toShipmentSnapshot({
        provider: "biteship",
        status: "shipped",
        biteship_order_id: "BT-1",
        biteship_tracking_id: "TR-1",
        waybill_number: "WB-12345",
        waybill_source: "system",
        waybill_overridden_by: null,
        waybill_override_reason: null,
        waybill_overridden_at: null,
        latest_biteship_status: "picked",
      }),
    ).toEqual({
      exists: true,
      provider: "biteship",
      status: "shipped",
      biteship_order_id: "BT-1",
      biteship_tracking_id: "TR-1",
      waybill_number: "WB-12345",
      waybill_source: "system",
      waybill_overridden_by: null,
      waybill_override_reason: null,
      waybill_overridden_at: null,
      latest_biteship_status: "picked",
    });
  });

  it("builds a restore payload only when a shipment existed before the mutation", () => {
    expect(
      buildShipmentRestorePayload(createEmptyShipmentSnapshot(), "2026-04-18T00:00:00.000Z"),
    ).toBeNull();

    expect(
      buildShipmentRestorePayload(
        {
          exists: true,
          provider: "biteship",
          status: "awaiting_shipment",
          biteship_order_id: "BT-1",
          biteship_tracking_id: null,
          waybill_number: null,
          waybill_source: null,
          waybill_overridden_by: null,
          waybill_override_reason: null,
          waybill_overridden_at: null,
          latest_biteship_status: null,
        },
        "2026-04-18T00:00:00.000Z",
      ),
    ).toEqual({
      provider: "biteship",
      status: "awaiting_shipment",
      biteship_order_id: "BT-1",
      biteship_tracking_id: null,
      waybill_number: null,
      waybill_source: null,
      waybill_overridden_by: null,
      waybill_override_reason: null,
      waybill_overridden_at: null,
      latest_biteship_status: null,
      updated_at: "2026-04-18T00:00:00.000Z",
    });
  });

  it("rolls back when a downstream mutation fails after the primary write succeeded", async () => {
    const callLog: string[] = [];

    await expect(
      runMutationWithRollback({
        apply: async () => {
          callLog.push("order-updated");
          callLog.push("payment-updated");
          throw new Error("shipment failed");
        },
        shouldRollback: () => true,
        rollback: async () => {
          callLog.push("rollback");
        },
      }),
    ).rejects.toThrow("shipment failed");

    expect(callLog).toEqual([
      "order-updated",
      "payment-updated",
      "rollback",
    ]);
  });

  it("does not rollback when the primary mutation never succeeded", async () => {
    const callLog: string[] = [];

    await expect(
      runMutationWithRollback<{ id: string }>({
        apply: async () => {
          callLog.push("order-update-attempted");
          throw new Error("order failed");
        },
        shouldRollback: (result) => Boolean(result),
        rollback: async () => {
          callLog.push("rollback");
        },
      }),
    ).rejects.toThrow("order failed");

    expect(callLog).toEqual(["order-update-attempted"]);
  });

  it("surfaces the original mutation error even when rollback also fails", async () => {
    const rollbackErrors: string[] = [];

    await expect(
      runMutationWithRollback({
        apply: async () => {
          throw new Error("shipment failed");
        },
        shouldRollback: () => true,
        rollback: async () => {
          throw new Error("rollback failed");
        },
        onRollbackError: (rollbackError) => {
          rollbackErrors.push(String(rollbackError));
        },
      }),
    ).rejects.toThrow("shipment failed");

    expect(rollbackErrors).toHaveLength(1);
    expect(rollbackErrors[0]).toContain("rollback failed");
  });
});
