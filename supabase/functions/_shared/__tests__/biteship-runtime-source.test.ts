import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const targetRuntimeFiles = [
  "supabase/functions/biteship/index.ts",
  "supabase/functions/order-manager/index.ts",
  "supabase/functions/_shared/webhook-side-effects.ts",
];

describe("Biteship runtime config source migration", () => {
  it("removes direct Biteship provider env reads from runtime paths", () => {
    for (const relativePath of targetRuntimeFiles) {
      const source = readSource(relativePath);

      expect(source, relativePath).not.toContain('Deno.env.get("BITESHIP_API_KEY")');
      expect(source, relativePath).not.toContain("Missing BITESHIP_API_KEY");
    }
  });

  it("uses the shared runtime config helper for Biteship API key lookups", () => {
    const sharedSource = readSource("supabase/functions/_shared/biteship.ts");

    expect(sharedSource).toContain("CONFIG_KEYS.biteshipApiKey");
    expect(sharedSource).toContain("createRuntimeConfigProvider");
    expect(sharedSource).toContain("resolveBiteshipApiKeyFromRuntimeConfig");
  });

  it("registers the Biteship handler without a module-level API key guard", () => {
    const source = readSource("supabase/functions/biteship/index.ts");
    const serveIndex = source.indexOf("Deno.serve");

    expect(serveIndex).toBeGreaterThan(-1);
    expect(source.slice(0, serveIndex)).not.toContain("biteship.api_key");
    expect(source.slice(0, serveIndex)).not.toContain("BITESHIP_API_KEY");
  });

});
