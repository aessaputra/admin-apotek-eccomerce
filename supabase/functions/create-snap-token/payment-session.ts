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
  update: (payload: Record<string, unknown>) => PaymentMutationQuery;
  insert: (payload: Record<string, unknown>) => PaymentMutationQuery;
};

type PaymentMutationQuery = {
  eq: (column: string, value: unknown) => PaymentMutationQuery;
  select: (columns: string) => PaymentMutationQuery;
  single: () => PromiseLike<QueryResponse<unknown>>;
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
  values: {
    paymentId: string;
    midtransOrderId: string;
    bindingSource: MidtransConfigBindingSource;
    sourcePaymentId?: string;
    selectedConfig?: SelectedMidtransConfigBinding;
  },
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
  values: {
    midtransOrderId: string;
    snapToken?: string;
    redirectUrl?: string;
    snapTokenCreatedAt?: string;
    grossAmount?: number;
    bindingSource?: MidtransConfigBindingSource;
    sourcePaymentId?: string;
    selectedConfig?: SelectedMidtransConfigBinding;
  },
): Promise<PaymentSessionRow> {
  const { data: existingPayment, error: paymentLookupError } = await adminClient
    .from("payments")
    .select("id")
    .eq("order_id", order.id)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentLookupError) {
    throw new PaymentSessionError(500, "Failed to look up payment session");
  }

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

  const existingPaymentId = readPaymentId(existingPayment);
  const paymentId = existingPaymentId
    ? await updatePaymentSession(adminClient, existingPaymentId, payload)
    : await insertPaymentSession(adminClient, payload);

  if (values.bindingSource) {
    await bindMidtransPaymentConfigVersions(adminClient, {
      paymentId,
      midtransOrderId: values.midtransOrderId,
      bindingSource: values.bindingSource,
      sourcePaymentId: values.sourcePaymentId,
      selectedConfig: values.selectedConfig,
    });
  }

  return {
    id: paymentId,
    midtrans_order_id: values.midtransOrderId,
    snap_token: payload.snap_token,
    redirect_url: payload.redirect_url,
    snap_token_created_at: payload.snap_token_created_at,
  };
}

async function updatePaymentSession(
  adminClient: PaymentSessionAdminClient,
  paymentId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await adminClient
    .from("payments")
    .update(payload)
    .eq("id", paymentId)
    .select("id")
    .single();

  if (error) {
    throw new PaymentSessionError(500, "Failed to update payment session");
  }

  return readPaymentId(data) ?? paymentId;
}

async function insertPaymentSession(
  adminClient: PaymentSessionAdminClient,
  payload: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await adminClient
    .from("payments")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    throw new PaymentSessionError(500, "Failed to create payment session");
  }

  const paymentId = readPaymentId(data);
  if (!paymentId) {
    throw new PaymentSessionError(500, "Failed to resolve payment session");
  }

  return paymentId;
}

function readPaymentId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const paymentId = (value as { id?: unknown }).id;
  return typeof paymentId === "string" && paymentId.length > 0
    ? paymentId
    : null;
}
