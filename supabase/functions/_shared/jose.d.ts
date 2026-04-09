declare module "npm:jose@5" {
  export interface JWTPayload {
    sub?: string;
    [key: string]: unknown;
  }

  export interface JWTVerifyOptions {
    issuer?: string;
    audience?: string;
  }

  export function createRemoteJWKSet(url: URL): unknown;

  export function jwtVerify(
    token: string,
    key: unknown,
    options?: JWTVerifyOptions,
  ): Promise<{ payload: JWTPayload }>;
}
