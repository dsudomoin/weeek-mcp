export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number)[];

/** A failed Weeek call: either the HTTP status said so, or the body did with `success: false`. */
export class WeeekApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly url: string;
  readonly details: unknown;

  // Parameter properties are TypeScript-only syntax, and node --test runs this file through type
  // stripping alone, so the fields are declared and assigned by hand.
  constructor(message: string, status: number, method: string, url: string, details: unknown) {
    super(message);
    this.name = "WeeekApiError";
    this.status = status;
    this.method = method;
    this.url = url;
    this.details = details;
  }
}

/**
 * Weeek takes booleans only as 1/0, and arrays only with brackets in the key.
 * Both deviations answer 422, so every query string is assembled here.
 */
export function buildQuery(params: Record<string, QueryValue>): URLSearchParams {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) search.append(`${key}[]`, String(item));
      continue;
    }

    search.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }

  return search;
}

/** Weeek date filters take dd.mm.yyyy; every caller has an ISO date. */
export function toApiDate(isoDate: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(isoDate);
  if (parts === null) {
    throw new Error(`Date must be in YYYY-MM-DD format, got: ${isoDate}`);
  }

  const [, year = "", month = "", day = ""] = parts;
  return `${day}.${month}.${year}`;
}

/**
 * Reads the payload of a `{success, ...}` envelope, which is how almost every Weeek endpoint
 * answers. A `success: false` arrives with HTTP 200 as well, so the body decides too.
 */
export function unwrapEnvelope<T>(payload: unknown, key: string): T {
  if (payload === null || typeof payload !== "object") {
    throw new WeeekApiError("Weeek returned a body that is not an object", 200, "", "", payload);
  }

  const record = payload as Record<string, unknown>;

  // Comments are the one endpoint answering without success, so only an explicit false counts.
  if (record["success"] === false) {
    throw new WeeekApiError("Weeek rejected the request", 200, "", "", record);
  }

  // A null passes an "in" check and then explodes at the caller's first use, far from the cause.
  if (record[key] == null) {
    throw new WeeekApiError(`Weeek response has no "${key}" field`, 200, "", "", record);
  }

  return record[key] as T;
}

/**
 * Renders an error for a model to read: what failed, where, and what Weeek said about it.
 * Invalid array items come back under dotted keys such as "tags.0" and are shown as "tags[0]".
 */
export function describeApiError(error: WeeekApiError): string {
  // Transport and envelope failures carry neither a request context nor any details,
  // so the message leads and the location is appended only when there is one.
  const location =
    error.method === "" || error.url === "" ? "" : ` (${error.method} ${error.url})`;
  const lines: string[] = [`${error.message}${location}`];

  const details = asRecord(error.details);
  const errors = asRecord(details?.["errors"]);
  const reported = details?.["message"];

  // Two shapes coexist and both are live: validation failures nest per-field messages under
  // "errors", while everything else (bad token, missing model) carries only "code" and "message".
  if (errors !== undefined) {
    for (const [field, messages] of Object.entries(errors)) {
      const readable = field.replace(/\.(\d+)/g, "[$1]");
      const text = Array.isArray(messages) ? messages.join("; ") : String(messages);
      lines.push(`  ${readable}: ${text}`);
    }
  } else if (typeof reported === "string" && reported !== "") {
    const code = details?.["code"];
    lines.push(`  ${reported}${typeof code === "number" ? ` (code ${code})` : ""}`);
  }

  return lines.join("\n");
}

/**
 * Reads a value as an object, or answers undefined.
 *
 * Every use of it is the same shape: something holding a payload Weeek sent, reaching for a field
 * that ought to be there, and needing the case where it is not to be a `null` it can answer around
 * rather than a `TypeError` thrown three lines later. `typeof null === "object"` is the whole
 * reason it exists as a function.
 *
 * It lives here rather than in the tools layer because `describeApiError` below needs it too, and
 * the http layer must not import from the tools one. `shared.ts` re-exports it so that a tool goes
 * on reaching for it in the one place a tool reaches for anything.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
