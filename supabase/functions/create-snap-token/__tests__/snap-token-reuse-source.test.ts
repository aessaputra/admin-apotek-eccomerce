import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(testDirectory, "../index.ts"), "utf8");

function getCallBlocks(functionName: string): string[] {
  const blocks: string[] = [];
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const callStart = source.indexOf(`${functionName}(adminClient,`, searchIndex);
    if (callStart === -1) break;

    const callEnd = source.indexOf(");", callStart);
    blocks.push(source.slice(callStart, callEnd));
    searchIndex = callEnd + 2;
  }

  return blocks;
}

function getBranchBlock(condition: string): string | undefined {
  const conditionStart = source.indexOf(`if (${condition})`);
  if (conditionStart === -1) return undefined;

  const blockStart = source.indexOf("{", conditionStart);
  let depth = 0;

  for (let index = blockStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;

    if (depth === 0) {
      return source.slice(blockStart, index + 1);
    }
  }

  return undefined;
}

describe("create-snap-token Snap token reuse source shape", () => {
  it("rejects cross-order idempotent Snap token reuse with a conflict before persistence", () => {
    const crossOrderReuseBranch = getBranchBlock("idempotentOrder.id !== order.id");

    expect(crossOrderReuseBranch).toBeDefined();
    expect(crossOrderReuseBranch).toContain("409");
    expect(crossOrderReuseBranch).toContain("idempotency_key_bound_to_existing_order");
    expect(crossOrderReuseBranch).not.toContain("persistPaymentSession(");
  });

  it("passes the reused payment id as sourcePaymentId for every snap_token_reuse binding", () => {
    const reuseBindingBlocks = getCallBlocks("bindMidtransPaymentConfigVersions")
      .filter((block) => block.includes('bindingSource: "snap_token_reuse"'));

    expect(reuseBindingBlocks).toHaveLength(4);

    for (const block of reuseBindingBlocks) {
      const paymentId = block.match(/paymentId:\s*([^,\n]+)/)?.[1]?.trim();

      expect(paymentId).toBeDefined();
      expect(block).toContain(`sourcePaymentId: ${paymentId}`);
    }
  });
  it("uses safe provider and lock failure messages instead of raw Midtrans/RPC details", () => {
    expect(source).toContain('"Midtrans token creation failed"');
    expect(source).not.toContain("midtransData.error_messages?.[0]");
    expect(source).not.toContain("midtransData.status_message");
    expect(source).not.toContain("releaseLockResponse.error.message");
    expect(source).not.toContain('console.error("[create-snap-token] Internal error:", message)');
  });

  it("logs create-snap-token failures with stable categories only", () => {
    expect(source).toContain("snap_token_provider_unavailable");
    expect(source).toContain("snap_token_lock_release_failed");
    expect(source).toContain("snap_token_internal_error");
    expect(source).not.toMatch(/console\.error\([^)]*error\.message/);
  });

  it("resolves and returns a sanitized request ID for every response path", () => {
    expect(source).toContain("resolveRequestId(req.headers)");
    expect(source).toContain("withRequestIdResponse(response, requestId)");
    expect(source).toContain("requestId");
  });

});
