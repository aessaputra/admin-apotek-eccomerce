export type BiteshipExceptionAlertType = "warning" | "error" | "info";

export interface BiteshipStatusResolution {
  nextStatus: string;
  mapped: boolean;
  exception?: {
    status: string;
    alertType: BiteshipExceptionAlertType;
    messageKey: string;
  };
}

export function getPersistedBiteshipShipmentStatus(
  status?: string | null,
): string {
  return status?.trim() || "awaiting_shipment";
}

const FORWARD_STATUS_MAP: Record<string, string> = {
  allocated: "awaiting_shipment",
  confirmed: "awaiting_shipment",
  picking_up: "awaiting_shipment",
  pickingUp: "awaiting_shipment",
  picked: "shipped",
  picked_up: "shipped",
  dropping_off: "in_transit",
  droppingOff: "in_transit",
  delivering: "in_transit",
  in_transit: "in_transit",
  delivered: "delivered",
};

const EXCEPTION_STATUS_MAP: Record<string, { alertType: BiteshipExceptionAlertType; messageKey: string }> = {
  on_hold: { alertType: "warning", messageKey: "on_hold" },
  onHold: { alertType: "warning", messageKey: "on_hold" },
  rejected: { alertType: "error", messageKey: "rejected" },
  courier_not_found: { alertType: "error", messageKey: "courier_not_found" },
  courierNotFound: { alertType: "error", messageKey: "courier_not_found" },
  return_in_transit: { alertType: "info", messageKey: "return_in_transit" },
  returnInTransit: { alertType: "info", messageKey: "return_in_transit" },
  returned: { alertType: "info", messageKey: "returned" },
  disposed: { alertType: "error", messageKey: "disposed" },
  cancelled: { alertType: "warning", messageKey: "cancelled" },
};

export function resolveBiteshipStatus(status: string, fallback: string): BiteshipStatusResolution {
  const mappedStatus = FORWARD_STATUS_MAP[status];
  if (mappedStatus) {
    return {
      nextStatus: mappedStatus,
      mapped: true,
    };
  }

  const exception = EXCEPTION_STATUS_MAP[status];
  if (exception) {
    return {
      nextStatus: fallback,
      mapped: false,
      exception: {
        status,
        alertType: exception.alertType,
        messageKey: exception.messageKey,
      },
    };
  }

  return {
    nextStatus: fallback,
    mapped: false,
  };
}
