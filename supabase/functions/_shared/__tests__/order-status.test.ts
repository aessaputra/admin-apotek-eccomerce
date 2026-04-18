import { describe, expect, it } from "vitest";

import {
  getPersistedBiteshipShipmentStatus,
  resolveBiteshipStatus,
} from "../order-status.ts";

describe("resolveBiteshipStatus", () => {
  it("maps forward Biteship progress into existing admin statuses", () => {
    expect(resolveBiteshipStatus("allocated", "processing")).toEqual({
      nextStatus: "awaiting_shipment",
      mapped: true,
    });

    expect(resolveBiteshipStatus("picked", "awaiting_shipment")).toEqual({
      nextStatus: "shipped",
      mapped: true,
    });

    expect(resolveBiteshipStatus("picked_up", "awaiting_shipment")).toEqual({
      nextStatus: "shipped",
      mapped: true,
    });

    expect(resolveBiteshipStatus("dropping_off", "shipped")).toEqual({
      nextStatus: "in_transit",
      mapped: true,
    });

    expect(resolveBiteshipStatus("delivered", "in_transit")).toEqual({
      nextStatus: "delivered",
      mapped: true,
    });
  });

  it("keeps admin status unchanged for Biteship exception states and exposes warning metadata", () => {
    expect(resolveBiteshipStatus("on_hold", "shipped")).toEqual({
      nextStatus: "shipped",
      mapped: false,
      exception: {
        status: "on_hold",
        alertType: "warning",
        messageKey: "on_hold",
      },
    });

    expect(resolveBiteshipStatus("returned", "in_transit")).toEqual({
      nextStatus: "in_transit",
      mapped: false,
      exception: {
        status: "returned",
        alertType: "info",
        messageKey: "returned",
      },
    });
  });

  it("falls back quietly for unknown statuses", () => {
    expect(resolveBiteshipStatus("mystery_status", "processing")).toEqual({
      nextStatus: "processing",
      mapped: false,
    });

    expect(resolveBiteshipStatus("scheduled", "processing")).toEqual({
      nextStatus: "processing",
      mapped: false,
    });
  });

  it("defaults persisted Biteship shipment state to awaiting_shipment until explicit sync progress exists", () => {
    expect(getPersistedBiteshipShipmentStatus()).toBe("awaiting_shipment");
    expect(getPersistedBiteshipShipmentStatus(null)).toBe("awaiting_shipment");
    expect(getPersistedBiteshipShipmentStatus("   ")).toBe("awaiting_shipment");
    expect(getPersistedBiteshipShipmentStatus("in_transit")).toBe("in_transit");
  });
});
