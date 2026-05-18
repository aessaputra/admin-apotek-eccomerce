import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_database_backed_integration_config.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing database backed integration config migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const extractFunctionSql = (sql: string, functionName: string) => {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(
    new RegExp(
      `create or replace function ${escapedFunctionName}[\\s\\S]*?\\$\\$;`,
      "i"
    )
  );

  if (!match) {
    throw new Error(`Missing function ${functionName}`);
  }

  return normalizeSql(match[0]);
};

describe("database backed integration config migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("creates private metadata, version, current pointer, audit, and Biteship snapshot tables", () => {
    expect(normalizedSql).toContain("create schema if not exists private");
    expect(normalizedSql).toContain(
      "create table if not exists private.integration_config_keys"
    );
    expect(normalizedSql).toContain(
      "key_name text primary key"
    );
    expect(normalizedSql).toContain("value_kind text not null");
    expect(normalizedSql).toContain("is_secret boolean not null");
    expect(normalizedSql).toContain(
      "create table if not exists private.integration_config_versions"
    );
    expect(normalizedSql).toContain(
      "vault_secret_id uuid references vault.secrets(id) on delete restrict"
    );
    expect(normalizedSql).toContain("non_secret_value jsonb");
    expect(normalizedSql).toContain("masked_value text");
    expect(normalizedSql).toContain("value_fingerprint text");
    expect(normalizedSql).toContain(
      "constraint integration_config_versions_value_storage_check"
    );
    expect(normalizedSql).toContain(
      "constraint integration_config_versions_key_version_uidx unique (key_name, version_number)"
    );
    expect(normalizedSql).toContain(
      "constraint integration_config_versions_key_version_id_uidx unique (key_name, version_number, id)"
    );
    expect(normalizedSql).toContain(
      "create table if not exists private.integration_config_current_versions"
    );
    expect(normalizedSql).toContain(
      "key_name text primary key references private.integration_config_keys(key_name) on delete cascade"
    );
    expect(normalizedSql).toContain(
      "create table if not exists private.integration_config_audit_logs"
    );
    expect(normalizedSql).toContain(
      "create table if not exists private.order_integration_config_snapshots"
    );
    expect(normalizedSql).toContain(
      "order_id uuid not null references public.orders(id) on delete cascade"
    );
    expect(normalizedSql).toContain(
      "shipment_id uuid references public.shipments(id) on delete set null"
    );
    expect(normalizedSql).toContain("origin_area_id text");
    expect(normalizedSql).toContain("origin_postal_code varchar(5)");
    expect(normalizedSql).toContain("origin_latitude numeric(10, 8)");
    expect(normalizedSql).toContain("origin_longitude numeric(11, 8)");
    expect(normalizedSql).toContain("courier_codes text[] not null");
    expect(normalizedSql).toContain("config_version_ids jsonb not null");
  });

  it("seeds the v1 integration config key definitions without committed values", () => {
    [
      "midtrans.server_key",
      "biteship.api_key",
      "push.expo_access_token",
      "midtrans.is_production",
      "biteship.origin_postal_code",
      "biteship.enabled_couriers",
      "shop.shipper_name",
      "shop.shipper_phone",
      "shop.shipper_email",
      "shop.address",
      "shop.organization",
      "cors.allowed_origins",
    ].forEach((keyName) => {
      expect(normalizedSql).toContain(`'${keyName}'`);
    });

    expect(normalizedSql).not.toMatch(/test_midtrans_key_placeholder|test_biteship_key_placeholder|test_expo_token_placeholder/);
    expect(normalizedSql).not.toMatch(/create_secret\([^;]*test_/);
  });

  it("adds constraints and indexes for current versions, audit lookup, and snapshots", () => {
    expect(normalizedSql).toContain(
      "constraint integration_config_current_versions_version_matches_key"
    );
    expect(normalizedSql).toContain("version_id uuid not null unique");
    expect(normalizedSql).toContain(
      "foreign key (key_name, version_number, version_id) references private.integration_config_versions(key_name, version_number, id) on delete restrict"
    );
    expect(normalizedSql).not.toContain(
      "version_id uuid not null unique references private.integration_config_versions(id)"
    );
    expect(normalizedSql).toContain(
      "create index if not exists integration_config_audit_logs_key_created_idx"
    );
    expect(normalizedSql).toContain(
      "on private.integration_config_audit_logs (key_name, created_at desc)"
    );
    expect(normalizedSql).toContain(
      "create index if not exists integration_config_audit_logs_actor_created_idx"
    );
    expect(normalizedSql).toContain(
      "on private.integration_config_audit_logs (actor_id, created_at desc)"
    );
    expect(normalizedSql).toContain(
      "create unique index if not exists order_integration_config_snapshots_order_uidx"
    );
    expect(normalizedSql).toContain(
      "on private.order_integration_config_snapshots (order_id)"
    );
    expect(normalizedSql).toContain(
      "create index if not exists order_integration_config_snapshots_shipment_idx"
    );
    expect(normalizedSql).toContain(
      "on private.order_integration_config_snapshots (shipment_id)"
    );
  });

  it("supports active, grace, and terminal config version statuses", () => {
    expect(normalizedSql).toContain(
      "constraint integration_config_versions_status_check"
    );
    expect(normalizedSql).toContain(
      "array['active'::text, 'grace'::text, 'retired'::text, 'disabled'::text, 'superseded'::text]"
    );
    expect(normalizedSql).toContain(
      "create unique index if not exists integration_config_versions_one_active_per_key_uidx"
    );
    expect(normalizedSql).toContain(
      "on private.integration_config_versions (key_name) where status = 'active'"
    );
    expect(normalizedSql).toContain(
      "create index if not exists integration_config_versions_key_status_created_idx"
    );
    expect(normalizedSql).toContain(
      "on private.integration_config_versions (key_name, status, created_at desc)"
    );
    expect(normalizedSql).toContain(
      "where status in ('active', 'grace')"
    );
  });

  it("transitions previous active versions when a new current version is activated", () => {
    const rotateSql = extractFunctionSql(
      migrationSql,
      "private.rotate_integration_config_secret"
    );
    const updateSql = extractFunctionSql(
      migrationSql,
      "private.update_integration_config_value"
    );

    expect(rotateSql).toContain("update private.integration_config_versions as old_versions");
    expect(rotateSql).toContain("status = 'grace'");
    expect(rotateSql).toContain("where old_versions.key_name = p_key_name");
    expect(rotateSql).toContain("old_versions.status = 'active'");
    expect(rotateSql).toContain("old_versions.id <> v_version_id");

    expect(updateSql).toContain("update private.integration_config_versions as old_versions");
    expect(updateSql).toContain("status = 'retired'");
    expect(updateSql).toContain("where old_versions.key_name = p_key_name");
    expect(updateSql).toContain("old_versions.status = 'active'");
    expect(updateSql).toContain("old_versions.id <> v_version_id");
  });

  it("keeps app tables free of plaintext secret columns", () => {
    const createTableStatements = migrationSql.match(/create table if not exists private\.[\s\S]*?;|alter table private\.[\s\S]*?;/gi) ?? [];
    const unsafeColumnPattern = /\b(raw_secret|secret_value|plaintext|decrypted_secret|api_key|server_key|access_token|token)\b\s+(text|varchar|jsonb|uuid)/i;

    createTableStatements.forEach((statement) => {
      expect(statement).not.toMatch(unsafeColumnPattern);
    });
  });

  it("defines hardened service-role-only runtime and mutation RPCs", () => {
    [
      "private.get_runtime_integration_config",
      "private.rotate_integration_config_secret",
      "private.update_integration_config_value",
      "private.list_integration_config_summary",
      "private.list_integration_config_audit",
    ].forEach((functionName) => {
      const functionSql = extractFunctionSql(migrationSql, functionName);
      expect(functionSql).toContain("security definer");
      expect(functionSql).toContain("set search_path = ''");
      expect(functionSql).toContain("auth.role()) <> 'service_role'");
      expect(functionSql).toMatch(/from private\./);
      expect(functionSql).not.toMatch(/\bfrom\s+(?!private\.|vault\.|auth\.|pg_catalog\.|public\.)[a-z_]+\./);
    });

    expect(normalizedSql).toContain(
      "revoke all on function private.get_runtime_integration_config(text[]) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function private.get_runtime_integration_config(text[]) to service_role"
    );
    expect(normalizedSql).toContain(
      "revoke all on function private.rotate_integration_config_secret(text, text, uuid, text, text, text) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function private.rotate_integration_config_secret(text, text, uuid, text, text, text) to service_role"
    );
    expect(normalizedSql).toContain(
      "revoke all on function private.update_integration_config_value(text, jsonb, uuid, text, text, text) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function private.update_integration_config_value(text, jsonb, uuid, text, text, text) to service_role"
    );
  });

  it("adds service-role public RPC wrappers without exposing private storage", () => {
    [
      "public.get_runtime_integration_config",
      "public.rotate_integration_config_secret",
      "public.update_integration_config_value",
      "public.list_integration_config_summary",
      "public.list_integration_config_audit",
    ].forEach((functionName) => {
      const functionSql = extractFunctionSql(migrationSql, functionName);
      expect(functionSql).toContain("security invoker");
      expect(functionSql).toContain("set search_path = ''");
      expect(functionSql).toContain("auth.role()) <> 'service_role'");
      expect(functionSql).toMatch(/from private\./);
      expect(functionSql).not.toContain("vault.decrypted_secrets");
    });

    expect(normalizedSql).toContain(
      "revoke all on function public.get_runtime_integration_config(text[]) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.get_runtime_integration_config(text[]) to service_role"
    );
    expect(normalizedSql).toContain(
      "revoke all on function public.rotate_integration_config_secret(text, text, uuid, text, text, text) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.rotate_integration_config_secret(text, text, uuid, text, text, text) to service_role"
    );
    expect(normalizedSql).toContain(
      "revoke all on function public.update_integration_config_value(text, jsonb, uuid, text, text, text) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.update_integration_config_value(text, jsonb, uuid, text, text, text) to service_role"
    );
  });

  it("limits Vault plaintext access to locked runtime and rotation routines", () => {
    expect(extractFunctionSql(migrationSql, "private.get_runtime_integration_config")).toContain(
      "vault.decrypted_secrets"
    );
    expect(extractFunctionSql(migrationSql, "private.rotate_integration_config_secret")).toContain(
      "vault.create_secret"
    );
    expect(extractFunctionSql(migrationSql, "private.list_integration_config_summary")).not.toContain(
      "vault.decrypted_secrets"
    );
    expect(extractFunctionSql(migrationSql, "private.list_integration_config_audit")).not.toContain(
      "vault.decrypted_secrets"
    );
  });

  it("returns only masked metadata from summary and audit routines", () => {
    const summarySql = extractFunctionSql(
      migrationSql,
      "private.list_integration_config_summary"
    );
    const auditSql = extractFunctionSql(
      migrationSql,
      "private.list_integration_config_audit"
    );

    expect(summarySql).toContain("masked_value text");
    expect(summarySql).toContain("value_fingerprint text");
    expect(summarySql).not.toContain("runtime_value");
    expect(summarySql).not.toContain("decrypted_secret");
    expect(auditSql).toContain("old_masked_value text");
    expect(auditSql).toContain("new_masked_value text");
    expect(auditSql).toContain("value_fingerprint text");
    expect(auditSql).not.toContain("runtime_value");
    expect(auditSql).not.toContain("decrypted_secret");
  });

  it("revokes direct private table access from browser roles", () => {
    [
      "private.integration_config_keys",
      "private.integration_config_versions",
      "private.integration_config_current_versions",
      "private.integration_config_audit_logs",
      "private.order_integration_config_snapshots",
    ].forEach((tableName) => {
      expect(normalizedSql).toContain(
        `revoke all on table ${tableName} from public, anon, authenticated`
      );
      expect(normalizedSql).toContain(
        `grant select, insert, update, delete on table ${tableName} to service_role`
      );
    });
  });
});
