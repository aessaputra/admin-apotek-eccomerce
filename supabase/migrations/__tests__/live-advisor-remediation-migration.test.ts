import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationSuffix = "_remediate_live_advisor_findings.sql";

const rlsNoPolicyTables = [
  "private.integration_config_audit_logs",
  "private.integration_config_current_versions",
  "private.integration_config_keys",
  "private.integration_config_rollout_status",
  "private.integration_config_versions",
  "private.midtrans_payment_config_bindings",
  "private.order_integration_config_snapshots",
  "public.notification_push_deliveries",
];

const fkIndexContracts = [
  {
    constraint: "integration_config_audit_logs_version_id_fkey",
    table: "private.integration_config_audit_logs",
    columns: "version_id",
  },
  {
    constraint: "integration_config_current_versions_activated_by_fkey",
    table: "private.integration_config_current_versions",
    columns: "activated_by",
  },
  {
    constraint: "integration_config_current_versions_version_matches_key",
    table: "private.integration_config_current_versions",
    columns: "key_name, version_number, version_id",
  },
  {
    constraint: "integration_config_versions_created_by_fkey",
    table: "private.integration_config_versions",
    columns: "created_by",
  },
  {
    constraint: "midtrans_payment_config_bindings_is_production_version_fk",
    table: "private.midtrans_payment_config_bindings",
    columns:
      "is_production_config_key_name, is_production_version_number, is_production_version_id",
  },
  {
    constraint: "midtrans_payment_config_bindings_server_key_version_fk",
    table: "private.midtrans_payment_config_bindings",
    columns:
      "server_key_config_key_name, server_key_version_number, server_key_version_id",
  },
  {
    constraint: "order_integration_config_snapshots_created_by_fkey",
    table: "private.order_integration_config_snapshots",
    columns: "created_by",
  },
];

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(migrationSuffix))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error(`Missing migration with suffix ${migrationSuffix}`);
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("live advisor remediation migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("adds explicit RLS policy blocks for every no-policy advisor table", () => {
    for (const table of rlsNoPolicyTables) {
      expect(normalizedSql).toContain(`alter table ${table} enable row level security`);
      expect(normalizedSql).toMatch(
        new RegExp(`create policy [^;]+ on ${table.replace(".", "\\.")}`),
      );
    }

    expect(normalizedSql).toContain(
      "notification_push_deliveries intentionally remains service-role only",
    );
  });

  it("does not add broad browser-facing using true policies for advisor fixes", () => {
    for (const table of rlsNoPolicyTables) {
      expect(normalizedSql).not.toMatch(
        new RegExp(
          `create policy [^;]+ on ${table.replace(".", "\\.")} [^;]+ to (anon|authenticated|public) [^;]+ using \\(true\\)`,
        ),
      );
    }

    expect(normalizedSql).not.toMatch(
      /create policy [^;]+ on public\.addresses [^;]+ to (anon|authenticated|public) [^;]+ using \(true\)/,
    );
  });

  it("documents and encodes the claim_profile_push_token authenticated RPC decision", () => {
    expect(normalizedSql).toContain("claim_profile_push_token");
    expect(normalizedSql).toContain("customer frontend");
    expect(normalizedSql).toContain("authenticated execute retained intentionally");
    expect(normalizedSql).toContain(
      "grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to authenticated",
    );
    expect(normalizedSql).not.toContain(
      "revoke all on function public.claim_profile_push_token(text, text, text, timestamptz) from authenticated",
    );
  });

  it("adds idempotent FK indexes with exact advisor column order", () => {
    for (const { constraint, table, columns } of fkIndexContracts) {
      expect(normalizedSql).toContain(constraint);
      expect(normalizedSql).toMatch(
        new RegExp(
          `create index if not exists [a-z0-9_]+ on ${table.replace(".", "\\.")} \\(${columns.replace(/, /g, "\\s*,\\s*")}\\)`,
        ),
      );
    }
  });

  it("consolidates public addresses authenticated SELECT policy without losing owner or admin shipping reads", () => {
    expect(normalizedSql).toContain(
      "drop policy if exists \"admins can view order shipping addresses\" on public.addresses",
    );
    expect(normalizedSql).toContain(
      "drop policy if exists \"users can manage their own addresses\" on public.addresses",
    );
    expect(normalizedSql).toMatch(
      /create policy [^;]+ on public\.addresses (?:[^;]+ )?for select to authenticated (?:[^;]+ )?using/,
    );
    expect(normalizedSql).toContain("((select auth.uid()) = profile_id)");
    expect(normalizedSql).toContain("(select private.is_admin())");
    expect(normalizedSql).not.toContain(" auth.uid() = profile_id");
    expect(normalizedSql).not.toContain(" private.is_admin() and exists");
    expect(normalizedSql).toContain("orders.shipping_address_id = addresses.id");
    expect(normalizedSql).toMatch(
      /create policy [^;]+ on public\.addresses (?:[^;]+ )?for (insert|update|all) [^;]+ with check \(.*\(select auth\.uid\(\)\) = profile_id/s,
    );
  });
});
