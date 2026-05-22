import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSqlBySuffix = (suffix: string) => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(suffix))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error(`Missing migration ${suffix}`);
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const findMigrationSql = () =>
  findMigrationSqlBySuffix("_stabilize_shipment_payment_settings_sources.sql");

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const stripSqlComments = (sql: string) =>
  sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const stripFunctionBodies = (sql: string) =>
  sql.replace(/\$\$[\s\S]*?\$\$/g, "$$FUNCTION_BODY$$");

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

describe("shipment settings schema cleanup stabilization migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);
  const schemaSql = normalizeSql(stripFunctionBodies(stripSqlComments(migrationSql)));

  it("documents retained ownership boundaries without removing schema", () => {
    expect(normalizedSql).toContain("comment on column public.orders.payment_status");
    expect(normalizedSql).toContain("legacy compatibility status");
    expect(normalizedSql).toContain("latest public.payments.status");

    [
      "public.settings.enabled_couriers",
      "public.settings.origin_postal_code",
      "public.settings.origin_area_id",
      "public.settings.origin_latitude",
      "public.settings.origin_longitude",
    ].forEach((columnName) => {
      expect(normalizedSql).toContain(`comment on column ${columnName}`);
      expect(normalizedSql).toContain("private integration config");
      expect(normalizedSql).toContain("candidate_deprecated");
    });

    [
      "public.settings.store_name",
      "public.settings.phone_number",
      "public.settings.email",
      "public.settings.organization",
      "public.settings.store_address",
    ].forEach((columnName) => {
      expect(normalizedSql).toContain(`comment on column ${columnName}`);
      expect(normalizedSql).toContain("keep_public_profile");
    });

    expect(normalizedSql).toContain(
      "comment on table private.order_integration_config_snapshots",
    );
    expect(normalizedSql).toContain("immutable_snapshot");
  });

  it("does not run destructive schema or data cleanup", () => {
    const disallowedTokens = [
      `${"dr"}op ${"ta"}ble`,
      `${"dr"}op ${"col"}umn`,
      `alter table public.orders ${"dr"}op`,
      `alter table public.settings ${"dr"}op`,
      `${"re"}name ${"col"}umn`,
      `${"re"}name ${"ta"}ble`,
      `${"del"}ete from`,
      `${"trun"}cate ${"ta"}ble`,
      `${"up"}date public.orders`,
      `${"up"}date public.settings`,
    ];

    disallowedTokens.forEach((token) => {
      expect(schemaSql).not.toContain(token);
    });
  });

  it("replaces the admin notification producer while preserving trigger semantics", () => {
    const functionSql = extractFunctionSql(migrationSql, "private.notify_admins_of_new_order");

    expect(functionSql).toContain("security definer");
    expect(functionSql).toContain("set search_path = ''");
    expect(functionSql).toContain("insert into public.notifications");
    expect(functionSql).toContain("from public.profiles as admin_profile");
    expect(functionSql).toContain("left join public.profiles as customer_profile");
    expect(functionSql).toContain("where admin_profile.role = 'admin'");
    expect(functionSql).toContain("'new_order'");
    expect(functionSql).toContain("'admin:new-order:' || new.id::text");
    expect(functionSql).toContain("'audience', 'admin_dashboard'");
    expect(functionSql).toContain("'orderid', new.id");
    expect(functionSql).toContain("'customername', customer_profile.full_name");
    expect(functionSql).toContain("'orderstatus', new.status");
    expect(functionSql).toContain("'createdat', new.created_at");
    expect(functionSql).toContain("'route', notification_route");
    expect(functionSql).toContain("'/orders/show/' || new.id::text");
    expect(normalizedSql).toContain(
      "create or replace trigger orders_admin_new_order_notifications_trigger after insert on public.orders for each row execute function private.notify_admins_of_new_order()",
    );
  });

  it("derives notification payment status from the latest payment row", () => {
    const functionSql = extractFunctionSql(migrationSql, "private.notify_admins_of_new_order");

    expect(functionSql).toContain("v_payment_status public.payment_status");
    expect(functionSql).toContain("select payments.status into v_payment_status");
    expect(functionSql).toContain("from public.payments");
    expect(functionSql).toContain("where payments.order_id = new.id");
    expect(functionSql).toContain("order by payments.updated_at desc, payments.created_at desc");
    expect(functionSql).toContain("limit 1");
    expect(functionSql).toContain("coalesce(v_payment_status, 'pending'::public.payment_status)");
    expect(functionSql).toContain("'paymentstatus', pg_catalog.coalesce(v_payment_status, 'pending'::public.payment_status)");
    expect(functionSql).not.toContain(["new", "payment_status"].join("."));
  });

  it("keeps private function execution locked away from browser roles", () => {
    expect(normalizedSql).toContain(
      "revoke all on function private.notify_admins_of_new_order() from public, anon, authenticated",
    );
  });
});


describe("order read-model customer/admin contract", () => {
  const readModelSql = findMigrationSqlBySuffix("_fix_order_backend_lint_contracts.sql");
  const normalizedReadModelSql = normalizeSql(readModelSql);

  it("keeps order_read_model security-invoker with payment and shipment rollup fields", () => {
    expect(normalizedReadModelSql).toContain("create or replace view public.order_read_model");
    expect(normalizedReadModelSql).toContain("with (security_invoker = true)");
    expect(normalizedReadModelSql).toContain("coalesce(p.status, 'pending'::public.payment_status) as payment_status");

    [
      "s.biteship_order_id",
      "s.biteship_tracking_id",
      "s.waybill_number",
      "s.waybill_source",
      "s.destination_area_id",
      "s.destination_postal_code",
      "s.origin_area_id",
      "s.courier_code",
      "s.courier_service",
      "s.shipping_etd",
    ].forEach((fieldExpression) => {
      expect(normalizedReadModelSql).toContain(fieldExpression);
    });
  });
});
