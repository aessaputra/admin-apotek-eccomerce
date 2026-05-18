import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const findRuntimeLookupMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_runtime_config_version_lookup.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing runtime config version lookup migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

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

describe("runtime config version lookup migration", () => {
  const migrationSql = findRuntimeLookupMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("adds private and public runtime lookup RPCs for active, grace, and explicit versions", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.get_runtime_integration_config_versions",
    );
    const publicSql = extractFunctionSql(
      migrationSql,
      "public.get_runtime_integration_config_versions",
    );

    expect(privateSql).toContain("p_key_names text[] default null");
    expect(privateSql).toContain("p_version_numbers jsonb default '{}'::jsonb");
    expect(privateSql).toContain("p_include_grace boolean default true");
    expect(privateSql).toContain("status text");
    expect(privateSql).toContain("runtime_value jsonb");
    expect(publicSql).toContain("select * from private.get_runtime_integration_config_versions");
  });

  it("keeps Vault plaintext access locked behind a service-role private function", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.get_runtime_integration_config_versions",
    );
    const publicSql = extractFunctionSql(
      migrationSql,
      "public.get_runtime_integration_config_versions",
    );

    expect(privateSql).toContain("security definer");
    expect(privateSql).toContain("set search_path = ''");
    expect(privateSql).toContain("auth.role()) <> 'service_role'");
    expect(privateSql).toContain("vault.decrypted_secrets");
    expect(publicSql).toContain("security invoker");
    expect(publicSql).toContain("auth.role()) <> 'service_role'");
    expect(publicSql).not.toContain("vault.decrypted_secrets");
  });

  it("selects active plus grace rows unless an explicit version is requested", () => {
    const privateSql = extractFunctionSql(
      migrationSql,
      "private.get_runtime_integration_config_versions",
    );

    expect(privateSql).toContain("p_version_numbers ? k.key_name");
    expect(privateSql).toContain("v.version_number = (p_version_numbers ->> k.key_name)::integer");
    expect(privateSql).toContain("v.status = 'active'");
    expect(privateSql).toContain("p_include_grace is true and v.status = 'grace'");
    expect(privateSql).toContain("case v.status when 'active' then 0 when 'grace' then 1 else 2 end");
  });

  it("exposes the version lookup RPC only to service_role", () => {
    expect(normalizedSql).toContain(
      "revoke all on function private.get_runtime_integration_config_versions(text[], jsonb, boolean) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "revoke all on function public.get_runtime_integration_config_versions(text[], jsonb, boolean) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function private.get_runtime_integration_config_versions(text[], jsonb, boolean) to service_role",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.get_runtime_integration_config_versions(text[], jsonb, boolean) to service_role",
    );
  });
});
