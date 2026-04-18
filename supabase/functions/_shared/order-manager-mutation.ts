export type WaybillSource = "system" | "manual" | null;

type RollbackRunnerOptions<T> = {
  apply: () => Promise<T>;
  rollback: () => Promise<void>;
  shouldRollback: (result: T | null) => boolean;
  onRollbackError?: (rollbackError: unknown, mutationError: unknown) => void;
};

export type ShipmentSnapshot = {
  exists: boolean;
  status: string | null;
  provider: string | null;
  biteship_order_id: string | null;
  biteship_tracking_id: string | null;
  waybill_number: string | null;
  waybill_source: WaybillSource;
  waybill_overridden_by: string | null;
  waybill_override_reason: string | null;
  waybill_overridden_at: string | null;
  latest_biteship_status: string | null;
};

export function createEmptyShipmentSnapshot(): ShipmentSnapshot {
  return {
    exists: false,
    status: null,
    provider: null,
    biteship_order_id: null,
    biteship_tracking_id: null,
    waybill_number: null,
    waybill_source: null,
    waybill_overridden_by: null,
    waybill_override_reason: null,
    waybill_overridden_at: null,
    latest_biteship_status: null,
  };
}

export function toShipmentSnapshot(
  row: Partial<ShipmentSnapshot> | null | undefined,
): ShipmentSnapshot {
  if (!row) {
    return createEmptyShipmentSnapshot();
  }

  return {
    exists: true,
    status: row.status ?? null,
    provider: row.provider ?? null,
    biteship_order_id: row.biteship_order_id ?? null,
    biteship_tracking_id: row.biteship_tracking_id ?? null,
    waybill_number: row.waybill_number ?? null,
    waybill_source: row.waybill_source ?? null,
    waybill_overridden_by: row.waybill_overridden_by ?? null,
    waybill_override_reason: row.waybill_override_reason ?? null,
    waybill_overridden_at: row.waybill_overridden_at ?? null,
    latest_biteship_status: row.latest_biteship_status ?? null,
  };
}

export function buildShipmentRestorePayload(
  snapshot: ShipmentSnapshot,
  updatedAt: string,
): Record<string, unknown> | null {
  if (!snapshot.exists) {
    return null;
  }

  return {
    provider: snapshot.provider,
    status: snapshot.status,
    biteship_order_id: snapshot.biteship_order_id,
    biteship_tracking_id: snapshot.biteship_tracking_id,
    waybill_number: snapshot.waybill_number,
    waybill_source: snapshot.waybill_source,
    waybill_overridden_by: snapshot.waybill_overridden_by,
    waybill_override_reason: snapshot.waybill_override_reason,
    waybill_overridden_at: snapshot.waybill_overridden_at,
    latest_biteship_status: snapshot.latest_biteship_status,
    updated_at: updatedAt,
  };
}

export async function runMutationWithRollback<T>(
  options: RollbackRunnerOptions<T>,
): Promise<T> {
  let result: T | null = null;

  try {
    result = await options.apply();
    return result;
  } catch (mutationError) {
    if (options.shouldRollback(result)) {
      try {
        await options.rollback();
      } catch (rollbackError) {
        options.onRollbackError?.(rollbackError, mutationError);
      }
    }

    throw mutationError;
  }
}
