import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const targetRuntimeFiles = [
  "supabase/functions/midtrans-webhook/index.ts",
  "supabase/functions/confirm-midtrans-payment/index.ts",
  "supabase/functions/reconcile-pending-midtrans-payments/index.ts",
  "supabase/functions/order-manager/index.ts",
  "supabase/functions/order-manager/handler.ts",
  "supabase/functions/cancel-user-order/index.ts",
  "supabase/functions/cancel-user-order/handler.ts",
];

describe("Midtrans runtime config source migration", () => {
  it("removes direct Midtrans provider env reads from migrated payment functions", () => {
    for (const relativePath of targetRuntimeFiles) {
      const source = readSource(relativePath);

      expect(source, relativePath).not.toContain('Deno.env.get("MIDTRANS_SERVER_KEY")');
      expect(source, relativePath).not.toContain('Deno.env.get("MIDTRANS_IS_PRODUCTION")');
    }
  });

  it("uses transaction-bound runtime config before Midtrans status or cancel calls", () => {
    for (const relativePath of [
      "supabase/functions/confirm-midtrans-payment/handler.ts",
      "supabase/functions/reconcile-pending-midtrans-payments/handler.ts",
      "supabase/functions/order-manager/handler.ts",
      "supabase/functions/cancel-user-order/handler.ts",
    ]) {
      const source = readSource(relativePath);
      const runtimeLookupIndex = source.indexOf("resolveMidtransTransactionRuntimeConfig");
      const directStatusCheckIndex = source.indexOf("verifyMidtransTransaction(");
      const injectedStatusCheckIndex = source.indexOf("verifyTransaction(");
      const statusCheckIndex = Math.max(
        directStatusCheckIndex,
        injectedStatusCheckIndex,
      );

      expect(runtimeLookupIndex, relativePath).toBeGreaterThan(-1);
      expect(statusCheckIndex, relativePath).toBeGreaterThan(runtimeLookupIndex);
      expect(source, relativePath).toContain("runtimeConfig.serverKey");
      expect(source, relativePath).toContain("isProduction: runtimeConfig.isProduction");
    }
  });

  it("keeps webhook signature resolution before raw notification persistence", () => {
    const source = readSource("supabase/functions/midtrans-webhook/index.ts");
    const runtimeSignatureIndex = source.indexOf("await resolveMidtransWebhookRuntimeConfig");
    const invalidSignatureIndex = source.indexOf("Invalid signature");
    const persistRawIndex = source.indexOf("await persistRawNotificationEarly");

    expect(runtimeSignatureIndex).toBeGreaterThan(-1);
    expect(invalidSignatureIndex).toBeGreaterThan(runtimeSignatureIndex);
    expect(persistRawIndex).toBeGreaterThan(invalidSignatureIndex);
  });
});
