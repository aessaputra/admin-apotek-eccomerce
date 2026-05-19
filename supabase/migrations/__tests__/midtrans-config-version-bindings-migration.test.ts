import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_midtrans_config_version_bindings.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing Midtrans config version bindings migration");
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

describe("Midtrans config version binding migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("creates a private payment binding table keyed by payment and Midtrans order ID", () => {
    expect(normalizedSql).toContain(
      "create table if not exists private.midtrans_payment_config_bindings",
    );
    expect(normalizedSql).toContain(
      "payment_id uuid not null references public.payments(id) on delete cascade",
    );
    expect(normalizedSql).toContain("midtrans_order_id text not null");
    expect(normalizedSql).toContain(
      "constraint midtrans_payment_config_bindings_payment_uidx unique (payment_id)",
    );
    expect(normalizedSql).toContain(
      "constraint midtrans_payment_config_bindings_midtrans_order_uidx unique (midtrans_order_id)",
    );
    expect(normalizedSql).toContain(
      "revoke all on table private.midtrans_payment_config_bindings from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant select, insert, update, delete on table private.midtrans_payment_config_bindings to service_role",
    );
  });

  it("binds both Midtrans config keys through composite version foreign keys", () => {
    expect(normalizedSql).toContain(
      "server_key_config_key_name text not null default 'midtrans.server_key'",
    );
    expect(normalizedSql).toContain("server_key_version_id uuid not null");
    expect(normalizedSql).toContain("server_key_version_number integer not null");
    expect(normalizedSql).toContain(
      "is_production_config_key_name text not null default 'midtrans.is_production'",
    );
    expect(normalizedSql).toContain("is_production_version_id uuid not null");
    expect(normalizedSql).toContain("is_production_version_number integer not null");
    expect(normalizedSql).toContain("is_production boolean not null");
    expect(normalizedSql).toContain(
      "constraint midtrans_payment_config_bindings_server_key_version_fk foreign key (server_key_config_key_name, server_key_version_number, server_key_version_id) references private.integration_config_versions(key_name, version_number, id) on delete restrict",
    );
    expect(normalizedSql).toContain(
      "constraint midtrans_payment_config_bindings_is_production_version_fk foreign key (is_production_config_key_name, is_production_version_number, is_production_version_id) references private.integration_config_versions(key_name, version_number, id) on delete restrict",
    );
  });

  it("backfills legacy Midtrans payments to migration-time active config metadata only", () => {
    expect(normalizedSql).toContain(
      "legacy Midtrans payments are bound to whichever active Midtrans config versions exist at migration time".toLowerCase(),
    );
    expect(normalizedSql).toContain("from public.payments as p");
    expect(normalizedSql).toContain("where p.midtrans_order_id is not null");
    expect(normalizedSql).toContain("'legacy_backfill'");
    expect(normalizedSql).toContain("server_version.key_name = 'midtrans.server_key'");
    expect(normalizedSql).toContain("production_version.key_name = 'midtrans.is_production'");
  });

  it("preserves an existing transaction binding when Snap tokens are reused", () => {
    const bindSql = extractFunctionSql(
      migrationSql,
      "private.bind_midtrans_payment_config_versions",
    );

    expect(bindSql).toContain("on conflict (payment_id) do update");
    expect(bindSql).toContain(
      "server_key_version_id = private.midtrans_payment_config_bindings.server_key_version_id",
    );
    expect(bindSql).toContain(
      "server_key_version_number = private.midtrans_payment_config_bindings.server_key_version_number",
    );
    expect(bindSql).toContain(
      "is_production_version_id = private.midtrans_payment_config_bindings.is_production_version_id",
    );
    expect(bindSql).toContain(
      "is_production_version_number = private.midtrans_payment_config_bindings.is_production_version_number",
    );
    expect(bindSql).toContain(
      "is_production = private.midtrans_payment_config_bindings.is_production",
    );
  });

  it("returns an existing target binding before reading active current config", () => {
    const bindSql = extractFunctionSql(
      migrationSql,
      "private.bind_midtrans_payment_config_versions",
    );
    const targetLookupIndex = bindSql.indexOf(
      "from private.midtrans_payment_config_bindings as target_binding",
    );
    const targetReturnIndex = bindSql.indexOf("if found then return query select");
    const currentConfigIndex = bindSql.indexOf(
      "from private.integration_config_current_versions as server_current",
    );

    expect(targetLookupIndex).toBeGreaterThan(-1);
    expect(targetReturnIndex).toBeGreaterThan(targetLookupIndex);
    expect(currentConfigIndex).toBeGreaterThan(targetReturnIndex);
    expect(bindSql).toContain("where target_binding.payment_id = p_payment_id");
  });

  it("copies source transaction binding metadata for cross-payment Snap token reuse", () => {
    const bindSql = extractFunctionSql(
      migrationSql,
      "private.bind_midtrans_payment_config_versions",
    );
    const publicSql = extractFunctionSql(
      migrationSql,
      "public.bind_midtrans_payment_config_versions",
    );

    expect(bindSql).toContain("p_source_payment_id uuid default null");
    const sourceLookupIndex = bindSql.indexOf(
      "from private.midtrans_payment_config_bindings as source_binding",
    );
    const currentConfigIndex = bindSql.indexOf(
      "from private.integration_config_current_versions as server_current",
    );

    expect(sourceLookupIndex).toBeGreaterThan(-1);
    expect(currentConfigIndex).toBeGreaterThan(sourceLookupIndex);
    expect(bindSql).toContain("source_binding.payment_id = p_source_payment_id");
    expect(bindSql).toContain("if p_source_payment_id is not null then");
    expect(bindSql).toContain("if not found then raise exception 'source midtrans payment config binding is required for snap token reuse'");
    expect(bindSql).toContain("else select server_version.id");
    expect(publicSql).toContain("p_source_payment_id uuid default null");
    expect(publicSql).toContain("p_source_payment_id");
  });

  it("accepts explicit selected config metadata for fresh Snap token bindings before active lookup", () => {
    const bindSql = extractFunctionSql(
      migrationSql,
      "private.bind_midtrans_payment_config_versions",
    );
    const publicSql = extractFunctionSql(
      migrationSql,
      "public.bind_midtrans_payment_config_versions",
    );

    expect(bindSql).toContain("p_server_key_version_id uuid default null");
    expect(bindSql).toContain("p_server_key_version_number integer default null");
    expect(bindSql).toContain("p_is_production_version_id uuid default null");
    expect(bindSql).toContain("p_is_production_version_number integer default null");
    expect(bindSql).toContain("p_is_production boolean default null");
    expect(bindSql).toContain("v_has_explicit_config boolean");
    expect(bindSql).toContain("v_has_partial_explicit_config boolean");
    expect(bindSql).toContain("explicit midtrans config version metadata must be provided as a complete set");

    const explicitBranchIndex = bindSql.indexOf("if v_has_explicit_config then");
    const sourceBranchIndex = bindSql.indexOf("if p_source_payment_id is not null then");
    const currentConfigIndex = bindSql.indexOf(
      "from private.integration_config_current_versions as server_current",
    );

    expect(explicitBranchIndex).toBeGreaterThan(sourceBranchIndex);
    expect(currentConfigIndex).toBeGreaterThan(explicitBranchIndex);
    expect(bindSql).toContain("v_server_key_version_id := p_server_key_version_id");
    expect(bindSql).toContain("v_server_key_version_number := p_server_key_version_number");
    expect(bindSql).toContain("v_is_production_version_id := p_is_production_version_id");
    expect(bindSql).toContain("v_is_production_version_number := p_is_production_version_number");
    expect(bindSql).toContain("v_is_production := p_is_production");
    expect(publicSql).toContain("p_server_key_version_id uuid default null");
    expect(publicSql).toContain("p_is_production boolean default null");
  });

  it("exposes only service-role RPC wrappers and stores no plaintext Midtrans secret", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.bind_midtrans_payment_config_versions",
    );
    const publicSql = extractFunctionSql(
      migrationSql,
      "public.bind_midtrans_payment_config_versions",
    );

    expect(privateSql).toContain("security definer");
    expect(privateSql).toContain("set search_path = ''");
    expect(privateSql).toContain("auth.role()) <> 'service_role'");
    expect(privateSql).not.toContain("vault.decrypted_secrets");
    expect(publicSql).toContain("security invoker");
    expect(publicSql).toContain("select * from private.bind_midtrans_payment_config_versions");
    expect(normalizedSql).toContain(
      "revoke all on function public.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) to service_role",
    );
    expect(normalizedSql).not.toMatch(/midtrans_server_key\s+(text|varchar|jsonb|uuid)/);
    expect(normalizedSql).not.toMatch(/server_key\s+(text|varchar|jsonb|uuid)/);
    expect(normalizedSql).not.toContain("test_sentinel_midtrans_secret_do_not_store");
  });
});
