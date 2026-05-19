import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_midtrans_runtime_config_binding_lookup.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing Midtrans runtime config binding lookup migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("Midtrans runtime config binding lookup migration", () => {
  const normalizedSql = normalizeSql(migrationSql());

  it("exposes a service-role-only binding lookup by Midtrans order ID", () => {
    expect(normalizedSql).toContain(
      "create or replace function private.get_midtrans_payment_config_binding",
    );
    expect(normalizedSql).toContain(
      "from private.midtrans_payment_config_bindings as binding",
    );
    expect(normalizedSql).toContain(
      "where binding.midtrans_order_id = pg_catalog.btrim(p_midtrans_order_id)",
    );
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(normalizedSql).toContain("auth.role()) <> 'service_role'");
    expect(normalizedSql).toContain(
      "revoke all on function public.get_midtrans_payment_config_binding(text) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.get_midtrans_payment_config_binding(text) to service_role",
    );
  });

  it("returns only version metadata and never plaintext Midtrans secrets", () => {
    expect(normalizedSql).toContain("server_key_version_id uuid");
    expect(normalizedSql).toContain("server_key_version_number integer");
    expect(normalizedSql).toContain("is_production_version_id uuid");
    expect(normalizedSql).toContain("is_production_version_number integer");
    expect(normalizedSql).toContain("is_production boolean");
    expect(normalizedSql).not.toContain("vault.decrypted_secrets");
    expect(normalizedSql).not.toMatch(/server_key\s+(text|varchar|jsonb)/);
    expect(normalizedSql).not.toContain("test_sentinel_midtrans_secret_do_not_store");
  });
});
