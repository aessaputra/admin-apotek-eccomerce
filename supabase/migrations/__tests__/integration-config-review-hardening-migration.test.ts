import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_harden_integration_config_review_findings.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing integration config review hardening migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const extractFunctionSql = (sql: string, functionName: string) => {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(
    new RegExp(
      `create or replace function ${escapedFunctionName}[\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );

  if (!match) {
    throw new Error(`Missing function ${functionName}`);
  }

  return normalizeSql(match[0]);
};

describe("integration config review hardening migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("adds atomic Midtrans payment-session persistence RPCs", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.persist_midtrans_payment_session",
    );
    const publicSql = extractFunctionSql(
      migrationSql,
      "public.persist_midtrans_payment_session",
    );

    expect(privateSql).toContain("security definer");
    expect(privateSql).toContain("set search_path = ''");
    expect(privateSql).toContain("auth.role()) <> 'service_role'");
    expect(privateSql).toContain("insert into public.payments");
    expect(privateSql).not.toContain("on conflict (midtrans_order_id) do update");
    expect(privateSql).toContain("midtrans order id is already bound to a different order");
    expect(privateSql).toContain("payments.midtrans_order_id = pg_catalog.btrim(p_midtrans_order_id)");
    expect(privateSql).toContain("select payments.id, payments.order_id into");
    expect(privateSql).toContain("v_existing_midtrans_payment_id, v_existing_payment_order_id");
    expect(privateSql).toContain("v_existing_payment_order_id <> p_order_id");
    expect(privateSql).toContain("from private.bind_midtrans_payment_config_versions");
    expect(publicSql).toContain("security invoker");
    expect(publicSql).toContain("select * from private.persist_midtrans_payment_session");
    expect(normalizedSql).toContain(
      "grant execute on function public.persist_midtrans_payment_session",
    );
    expect(normalizedSql).toContain("to service_role");
    expect(normalizedSql).toContain("from public, anon, authenticated");
  });

  it("keeps Midtrans binding source in lookup rows so runtime can distinguish legacy backfills", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.get_midtrans_payment_config_binding",
    );

    expect(privateSql).toContain("binding_source text");
    expect(privateSql).toContain("binding.binding_source");
  });

  it("revokes customer-readable access to sensitive Midtrans payload columns", () => {
    expect(normalizedSql).toContain(
      "revoke select on table public.payments from anon, authenticated",
    );
    expect(normalizedSql).not.toContain("on table public.payments to anon");
    expect(normalizedSql).toContain("on table public.payments to authenticated");
    expect(normalizedSql).toContain("midtrans_transaction_id");
    expect(normalizedSql).toContain("masked_card");
    expect(normalizedSql).toContain("snap_token");
    expect(normalizedSql).toContain("snap_token_created_at");
    expect(normalizedSql).not.toContain("signature_key,");
    expect(normalizedSql).not.toContain("raw_notification,");
    expect(normalizedSql).toContain("grant select on table public.payments to service_role");
  });

  it("rejects invalid Biteship coordinate config values before versioning", () => {
    const updateSql = extractFunctionSql(
      migrationSql,
      "private.update_integration_config_value",
    );

    expect(updateSql).toContain("p_key_name = 'biteship.origin_latitude'");
    expect(updateSql).toContain("p_key_name = 'biteship.origin_longitude'");
    expect(updateSql).toContain("biteship origin latitude must be a decimal between -90 and 90");
    expect(updateSql).toContain("biteship origin longitude must be a decimal between -180 and 180");
    expect(updateSql).toMatch(/v_coordinate\s+numeric/);
  });

  it("refreshes explicit or source Midtrans bindings instead of reusing stale payment bindings", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.bind_midtrans_payment_config_versions",
    );

    expect(privateSql).toContain("p_source_payment_id is null and not v_has_explicit_config");
    expect(privateSql).toContain("on conflict (payment_id) do update");
    expect(privateSql).toContain("server_key_version_id = excluded.server_key_version_id");
    expect(privateSql).toContain("binding_source = excluded.binding_source");
  });

  it("requires a source payment id before Snap token reuse can return or fall back", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.bind_midtrans_payment_config_versions",
    );
    const reuseSourceGuard =
      "if v_binding_source = 'snap_token_reuse' and p_source_payment_id is null then";

    expect(privateSql).toContain(reuseSourceGuard);
    expect(privateSql).toContain(
      "source midtrans payment config binding is required for snap token reuse",
    );
    expect(privateSql.indexOf(reuseSourceGuard)).toBeLessThan(
      privateSql.indexOf("select * into v_existing_binding"),
    );
    expect(privateSql.indexOf(reuseSourceGuard)).toBeLessThan(
      privateSql.indexOf("from private.integration_config_current_versions as server_current"),
    );
  });

});
