const REQUEST_ID_HEADER = "x-request-id";
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:/=-]+$/;

type RequestIdHeaders = Pick<Headers, "get">;

type RequestIdOptions = {
  generate?: () => string;
};

export function isSafeRequestId(value: string | null | undefined): value is string {
  if (!value || value.length > MAX_REQUEST_ID_LENGTH) {
    return false;
  }

  return SAFE_REQUEST_ID_PATTERN.test(value);
}

export function resolveRequestId(headers: RequestIdHeaders, options: RequestIdOptions = {}): string {
  const incomingRequestId = headers.get(REQUEST_ID_HEADER)?.trim();
  if (isSafeRequestId(incomingRequestId)) {
    return incomingRequestId;
  }

  return createSafeRequestId(options.generate);
}

export function withRequestIdHeader(headers: HeadersInit, requestId: string): Headers {
  const mergedHeaders = new Headers(headers);
  mergedHeaders.set(REQUEST_ID_HEADER, isSafeRequestId(requestId) ? requestId : createSafeRequestId());
  return mergedHeaders;
}

export function withRequestIdResponse(response: Response, requestId: string): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: withRequestIdHeader(response.headers, requestId),
  });
}

function createSafeRequestId(generate?: () => string): string {
  const generatedRequestId = generate?.() ?? generateRequestId();
  return isSafeRequestId(generatedRequestId) ? generatedRequestId : generateRequestId();
}

function generateRequestId(): string {
  const globalCrypto = globalThis.crypto;

  if (typeof globalCrypto?.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }

  if (typeof globalCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalCrypto.getRandomValues(bytes);
    return `req-${Array.from(bytes, toHexByte).join("")}`;
  }

  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toHexByte(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}
