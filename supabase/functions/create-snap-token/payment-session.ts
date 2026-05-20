import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import type { Order } from "../_shared/types.ts";

type QueryError = { message?: string } | null;
type QueryResponse<T> = { data: T | null; error: QueryError };

type PaymentLookupQuery = {
  eq: (column: string, value: unknown) => PaymentLookupQuery;
  order: (
    column: string,
    options?: { ascending?: boolean },
  ) => PaymentLookupQuery;
  limit: (count: number) => PaymentLookupQuery;
  maybeSingle: () => PromiseLike<QueryResponse<unknown>>;
};

type PaymentsTable = {
  select: (columns: string) => PaymentLookupQuery;
};

export type PaymentSessionAdminClient = Pick<
  ReturnType<typeof getSupabaseAdminClient>,
  "rpc"
> & {
  from: (tableName: "payments") => PaymentsTable;
};

export type PaymentSessionRow = {
  id?: string | null;
  midtrans_order_id?: string | null;
  snap_token?: string | null;
  redirect_url?: string | null;
  snap_token_created_at?: string | null;
};

export type MidtransConfigBindingSource =
  | "snap_token_created"
  | "snap_token_reuse";

export type SelectedMidtransConfigBinding = {
  serverKeyVersionId: string;
  serverKeyVersionNumber: number;
  isProductionVersionId: string;
  isProductionVersionNumber: number;
  isProduction: boolean;
};

type PersistPaymentSessionBaseValues = {
  midtransOrderId: string;
  snapToken?: string;
  redirectUrl?: string;
  snapTokenCreatedAt?: string;
  grossAmount?: number;
};

type PersistPaymentSessionBindingValues =
  | {
    bindingSource: "snap_token_created";
    selectedConfig: SelectedMidtransConfigBinding;
    sourcePaymentId?: never;
  }
  | {
    bindingSource: "snap_token_reuse";
    sourcePaymentId: string;
    selectedConfig?: SelectedMidtransConfigBinding;
  };

type PersistPaymentSessionValues = PersistPaymentSessionBaseValues &
  PersistPaymentSessionBindingValues;

type BindMidtransPaymentConfigVersionsValues =
  | {
    paymentId: string;
    midtransOrderId: string;
    bindingSource: "snap_token_created";
    sourcePaymentId?: string;
    selectedConfig?: SelectedMidtransConfigBinding;
  }
  | {
    paymentId: string;
    midtransOrderId: string;
    bindingSource: "snap_token_reuse";
    sourcePaymentId: string;
    selectedConfig?: SelectedMidtransConfigBinding;
  };

export class PaymentSessionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "PaymentSessionError";
  }
}

export async function getLatestPaymentSession(
  adminClient: PaymentSessionAdminClient,
  orderId: string,
): Promise<PaymentSessionRow | null> {
  const { data, error } = await adminClient
    .from("payments")
    .select(
      "id, midtrans_order_id, snap_token, redirect_url, snap_token_created_at",
    )
    .eq("order_id", orderId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new PaymentSessionError(500, "Failed to look up latest payment session");
  }

  return (data as PaymentSessionRow | null) ?? null;
}

export async function waitForAvailableSnapSession(
  adminClient: PaymentSessionAdminClient,
  orderId: string,
  isTokenExpired: (createdAt: string | null | undefined) => boolean,
): Promise<PaymentSessionRow | null> {
  const attempts = 6;
  const delayMs = 500;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await getLatestPaymentSession(adminClient, orderId);

    if (
      session?.snap_token &&
      session.redirect_url &&
      !isTokenExpired(session.snap_token_created_at)
    ) {
      return session;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return null;
}

export async function bindMidtransPaymentConfigVersions(
  adminClient: PaymentSessionAdminClient,
  values: BindMidtransPaymentConfigVersionsValues,
): Promise<void> {
  const rpcArgs = {
    p_payment_id: values.paymentId,
    p_midtrans_order_id: values.midtransOrderId,
    p_binding_source: values.bindingSource,
    ...(values.sourcePaymentId
      ? { p_source_payment_id: values.sourcePaymentId }
      : {}),
    ...(values.selectedConfig
      ? {
        p_server_key_version_id: values.selectedConfig.serverKeyVersionId,
        p_server_key_version_number: values.selectedConfig.serverKeyVersionNumber,
        p_is_production_version_id: values.selectedConfig.isProductionVersionId,
        p_is_production_version_number: values.selectedConfig.isProductionVersionNumber,
        p_is_production: values.selectedConfig.isProduction,
      }
      : {}),
  };

  const { error } = await adminClient.rpc(
    "bind_midtrans_payment_config_versions",
    rpcArgs,
  );

  if (error) {
    throw new PaymentSessionError(
      500,
      "Failed to bind Midtrans payment config versions",
    );
  }
}

export async function persistPaymentSession(
  adminClient: PaymentSessionAdminClient,
  order: Order,
  values: PersistPaymentSessionValues,
): Promise<PaymentSessionRow> {
  const payload = {
    order_id: order.id,
    user_id: order.user_id ?? null,
    checkout_idempotency_key: order.checkout_idempotency_key ?? null,
    midtrans_order_id: values.midtransOrderId,
    status: order.payment_status,
    payment_type: order.payment_type ?? null,
    gross_amount:
      values.grossAmount ??
      (order.gross_amount != null
        ? Number(order.gross_amount)
        : Number(order.total_amount || 0) + Number(order.shipping_cost || 0)),
    expiry_time: order.expired_at ?? null,
    snap_token: values.snapToken ?? order.snap_token ?? null,
    redirect_url: values.redirectUrl ?? order.snap_redirect_url ?? null,
    snap_token_created_at:
      values.snapTokenCreatedAt ?? order.snap_token_created_at ?? null,
  };

  if (!values.bindingSource) {
    throw new PaymentSessionError(
      500,
      "Midtrans payment sessions require config binding metadata",
    );
  }

  if (values.bindingSource === "snap_token_created" && !values.selectedConfig) {
    throw new PaymentSessionError(
      500,
      "New Midtrans Snap sessions require selected config metadata",
    );
  }

  if (values.bindingSource === "snap_token_reuse" && !values.sourcePaymentId) {
    throw new PaymentSessionError(
      500,
      "Reused Midtrans Snap sessions require source payment metadata",
    );
  }

  return persistBoundPaymentSession(adminClient, payload, values);
}

async function persistBoundPaymentSession(
  adminClient: PaymentSessionAdminClient,
  payload: Record<string, unknown>,
  values: PersistPaymentSessionBindingValues,
): Promise<PaymentSessionRow> {
  const { data, error } = await adminClient.rpc(
    "persist_midtrans_payment_session",
    {
      p_order_id: payload.order_id,
      p_user_id: payload.user_id,
      p_checkout_idempotency_key: payload.checkout_idempotency_key,
      p_midtrans_order_id: payload.midtrans_order_id,
      p_status: payload.status,
      p_payment_type: payload.payment_type,
      p_gross_amount: payload.gross_amount,
      p_expiry_time: payload.expiry_time,
      p_snap_token: payload.snap_token,
      p_redirect_url: payload.redirect_url,
      p_snap_token_created_at: payload.snap_token_created_at,
      p_binding_source: values.bindingSource,
      p_source_payment_id: values.sourcePaymentId ?? null,
      p_server_key_version_id: values.selectedConfig?.serverKeyVersionId ?? null,
      p_server_key_version_number: values.selectedConfig?.serverKeyVersionNumber ?? null,
      p_is_production_version_id: values.selectedConfig?.isProductionVersionId ?? null,
      p_is_production_version_number: values.selectedConfig?.isProductionVersionNumber ?? null,
      p_is_production: values.selectedConfig?.isProduction ?? null,
    },
  );

  if (error) {
    throw new PaymentSessionError(500, "Failed to persist payment session");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new PaymentSessionError(500, "Failed to resolve payment session");
  }

  return row as PaymentSessionRow;
}
