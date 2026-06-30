import { jsonResponse, errorResponse } from "./responses.ts";
import type { BiteshipWebhookPayload } from "../types.ts";

export function validateWebhookSecret(req: Request, expectedSecret: string): boolean {
  const url = new URL(req.url);
  const secretFromQuery = url.searchParams.get("secret");
  
  if (secretFromQuery === expectedSecret) {
    return true;
  }

  const secretFromHeader = req.headers.get("x-webhook-secret") || req.headers.get("x-biteship-signature");
  return secretFromHeader === expectedSecret;
}

export async function parseBiteshipPayload(
  req: Request
): Promise<BiteshipWebhookPayload | Response> {
  let rawBody = "";
  try {
    rawBody = await req.text();
    const isBiteshipTestPing = !rawBody.trim();
    
    if (isBiteshipTestPing) {
      console.info("[biteship-webhook] Empty body received");
      return jsonResponse({ status: "ok", message: "Empty body acknowledged" });
    }
    
    return JSON.parse(rawBody) as BiteshipWebhookPayload;
  } catch (err: unknown) {
    console.error("[biteship-webhook] Invalid JSON payload", {
      rawBody,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse(`Invalid JSON payload: ${rawBody}`, 400);
  }
}
