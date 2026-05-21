import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const functionsRoot = join(process.cwd(), "supabase/functions");
const allowedProviderEnvFallbacks = new Set([
  "supabase/functions/_shared/biteship.ts: \\bBITESHIP_API_KEY\\b",
]);

function listRuntimeSources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      if (entry === "__tests__") {
        return [];
      }

      return listRuntimeSources(absolutePath);
    }

    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) {
      return [];
    }

    return [absolutePath];
  });
}

describe("provider environment cutover source guard", () => {
  it("rejects unapproved provider env aliases, reads, and environment object dumps in runtime source", () => {
    const forbiddenPatterns = [
      /\bMIDTRANS_[A-Z0-9_]*\b/,
      /\bBITESHIP_API_KEY\b/,
      /\bEXPO_ACCESS_TOKEN\b/,
      /Deno\.env\.toObject\s*\(/,
    ];
    const violations = listRuntimeSources(functionsRoot).flatMap((absolutePath) => {
      const source = readFileSync(absolutePath, "utf8");
      const relativePath = relative(process.cwd(), absolutePath);

      return forbiddenPatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${relativePath}: ${pattern.source}`);
    }).filter((violation) => !allowedProviderEnvFallbacks.has(violation));

    expect(violations).toEqual([]);
  });
});
