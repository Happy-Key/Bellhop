export type ProviderErrorKind = "not_configured" | "network" | "http" | "malformed_response" | "rejected_output";

/** Error raised by any external provider. Messages must never include secrets. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(`[${provider}] ${kind}: ${message}`);
    this.name = "ProviderError";
  }
}

/** A failure worth one more try: a timeout or dropped connection, rate limiting, or a server error. */
export function isTransient(e: unknown): boolean {
  return e instanceof ProviderError && (e.kind === "network" || (e.kind === "http" && (e.httpStatus === 429 || (e.httpStatus ?? 0) >= 500)));
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Removes `key=...` query values and bearer tokens from text before it is logged or displayed. */
export function redact(text: string): string {
  return text
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b(sk_car_|fk-|cr_sk_)[A-Za-z0-9_-]+/g, "$1[REDACTED]");
}
