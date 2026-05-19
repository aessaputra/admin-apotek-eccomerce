import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const findSnapshotLifecycleMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_harden_biteship_order_config_snapshots.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing Biteship snapshot lifecycle migration");
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

describe("Biteship snapshot lifecycle migration", () => {
  const migrationSql = findSnapshotLifecycleMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("makes order integration config snapshots immutable after insert", () => {
    expect(normalizedSql).toContain(
      "drop trigger if exists order_integration_config_snapshots_updated_at_trigger",
    );
    expect(normalizedSql).toContain(
      "create or replace function private.prevent_order_integration_config_snapshot_mutation",
    );
    expect(normalizedSql).toContain(
      "raise exception 'order_integration_config_snapshots is immutable'",
    );
    expect(normalizedSql).toContain(
      "before update on private.order_integration_config_snapshots",
    );
    expect(normalizedSql).toContain(
      "before delete on private.order_integration_config_snapshots",
    );
    expect(normalizedSql).toContain(
      "revoke update, delete on table private.order_integration_config_snapshots from service_role",
    );
    expect(normalizedSql).toContain(
      "grant select, insert on table private.order_integration_config_snapshots to service_role",
    );
  });

  it("adds service-role snapshot create/read RPCs without exposing secrets", () => {
    const privateCreateSql = extractFunctionSql(
      migrationSql,
      "private.create_biteship_order_config_snapshot",
    );
    const privateReadSql = extractFunctionSql(
      migrationSql,
      "private.get_biteship_order_config_snapshot",
    );
    const publicCreateSql = extractFunctionSql(
      migrationSql,
      "public.create_biteship_order_config_snapshot",
    );
    const publicReadSql = extractFunctionSql(
      migrationSql,
      "public.get_biteship_order_config_snapshot",
    );

    expect(privateCreateSql).toContain("security definer");
    expect(privateCreateSql).toContain("set search_path = ''");
    expect(privateCreateSql).toContain("auth.role()) <> 'service_role'");
    expect(privateCreateSql).toContain("pg_advisory_xact_lock");
    expect(privateCreateSql).toContain("insert into private.order_integration_config_snapshots");
    expect(privateCreateSql).toContain("return query select * from private.get_biteship_order_config_snapshot");
    expect(privateCreateSql).toContain("('biteship.origin_area_id')");
    expect(privateCreateSql).toContain("('biteship.origin_latitude')");
    expect(privateCreateSql).toContain("('biteship.origin_longitude')");
    expect(privateCreateSql).toContain("required_config_key(key_name)");

    expect(privateReadSql).toContain("security definer");
    expect(privateReadSql).toContain("set search_path = ''");
    expect(privateReadSql).toContain("auth.role()) <> 'service_role'");
    expect(publicCreateSql).toContain("security invoker");
    expect(publicReadSql).toContain("security invoker");

    [privateCreateSql, privateReadSql, publicCreateSql, publicReadSql].forEach((functionSql) => {
      expect(functionSql).not.toContain("vault.decrypted_secrets");
      expect(functionSql).not.toContain("p_api_key");
      expect(functionSql).not.toContain(`biteship.${"api_key"}`);
      expect(functionSql).not.toContain("plaintext");
    });
  });

  it("rejects malformed per-key snapshot config version metadata", () => {
    const privateCreateSql = extractFunctionSql(
      migrationSql,
      "private.create_biteship_order_config_snapshot",
    );

    expect(privateCreateSql).toContain(
      "from (values ('biteship.origin_postal_code'), ('biteship.origin_area_id'), ('biteship.origin_latitude'), ('biteship.origin_longitude'), ('biteship.enabled_couriers'), ('shop.shipper_name'), ('shop.shipper_phone'), ('shop.shipper_email'), ('shop.address'), ('shop.organization') ) as required_config_key(key_name)",
    );
    expect(privateCreateSql).toContain(
      "pg_catalog.jsonb_typeof(p_config_version_ids -> required_config_key.key_name) <> 'object'",
    );
    expect(privateCreateSql).toContain(
      "not ((p_config_version_ids -> required_config_key.key_name) ? 'version_id')",
    );
    expect(privateCreateSql).toContain(
      "pg_catalog.jsonb_typeof((p_config_version_ids -> required_config_key.key_name) -> 'version_id') <> 'string'",
    );
    expect(privateCreateSql).toContain(
      "pg_catalog.btrim((p_config_version_ids -> required_config_key.key_name) ->> 'version_id') = ''",
    );
    expect(privateCreateSql).toContain(
      "not ((p_config_version_ids -> required_config_key.key_name) ? 'version_number')",
    );
    expect(privateCreateSql).toContain(
      "pg_catalog.jsonb_typeof((p_config_version_ids -> required_config_key.key_name) -> 'version_number') <> 'number'",
    );
    expect(privateCreateSql).toContain(
      "((p_config_version_ids -> required_config_key.key_name) ->> 'version_number') !~ '^[1-9][0-9]*$'",
    );
    expect(privateCreateSql).toContain(
      "must include non-empty version_id and positive integer version_number for every non-secret biteship snapshot config key",
    );
  });

  it("adds runtime config definitions for versioned Biteship snapshot origin metadata", () => {
    [
      "biteship.origin_area_id",
      "biteship.origin_latitude",
      "biteship.origin_longitude",
    ].forEach((keyName) => {
      expect(normalizedSql).toContain(`'${keyName}'`);
    });

    expect(normalizedSql).toContain("biteship origin area id");
    expect(normalizedSql).toContain("biteship origin latitude");
    expect(normalizedSql).toContain("biteship origin longitude");
    expect(normalizedSql).not.toContain("'biteship.api_key', 'biteship api key'");
  });

  it("exposes snapshot RPCs only to service_role", () => {
    [
      "private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid)",
      "private.get_biteship_order_config_snapshot(uuid)",
      "public.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid)",
      "public.get_biteship_order_config_snapshot(uuid)",
    ].forEach((signature) => {
      expect(normalizedSql).toContain(
        `revoke all on function ${signature} from public, anon, authenticated`,
      );
      expect(normalizedSql).toContain(
        `grant execute on function ${signature} to service_role`,
      );
    });
  });
});
