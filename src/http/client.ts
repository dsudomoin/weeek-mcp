import type { WeeekConfig } from "../config.ts";
import type { WeeekOperation } from "../openapi-types.ts";
import { type QueryValue, WeeekApiError, buildQuery } from "./quirks.ts";

export type RequestOptions = {
  pathParams?: Record<string, string | number>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  formData?: FormData;
};

type Deps = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
};

// Weeek documents no rate limit, sends no X-RateLimit-* headers, and answered a burst of 20
// parallel requests without a single 429, so this policy is guesswork and stays conservative.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

// Idempotent by HTTP semantics, so a replay cannot leave a second task or a second comment behind.
// POST and PATCH are not, and every Weeek endpoint that creates something is a POST.
const REPLAY_SAFE_METHODS = new Set<string>(["GET", "PUT", "DELETE"]);

/** The only layer that speaks HTTP: everything above it passes an operation and gets a body back. */
export class WeeekClient {
  readonly #config: WeeekConfig;
  readonly #fetch: typeof globalThis.fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  // Parameter properties are TypeScript-only syntax and node strips types rather than compiling
  // them, so the fields are declared and assigned by hand.
  constructor(config: WeeekConfig, deps: Deps = {}) {
    this.#config = config;
    this.#fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request(operation: WeeekOperation, options: RequestOptions = {}): Promise<unknown> {
    const url = this.#buildUrl(operation, options);
    const init = this.#buildInit(operation, options);
    const replaySafe = REPLAY_SAFE_METHODS.has(operation.method);

    let lastError: unknown;
    // The status of the response the last failure came from, if it got that far.
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      let payload: unknown;
      let arrivedWith: number | undefined;
      try {
        // A fresh signal per attempt: a spent one would abort the retry before it left.
        response = await this.#fetch(url, {
          ...init,
          signal: AbortSignal.timeout(this.#config.timeoutMs),
        });
        arrivedWith = response.status;
        // Reading the body is still transport: a connection dropped halfway through it fails here,
        // and that belongs with the other transport failures rather than escaping as a TypeError.
        payload = await parseBody(response);
      } catch (error) {
        lastError = error;
        lastStatus = arrivedWith;
        // A request that never came back may still have been applied, so it is sent again only
        // when a second copy of it would change nothing.
        if (!replaySafe || attempt === MAX_ATTEMPTS) break;
        await this.#sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok) {
        if (isRejection(payload)) {
          // unwrapEnvelope catches this too, but it receives the payload alone and cannot say
          // which call was rejected. Here the method and the resolved url are still at hand.
          throw new WeeekApiError(
            "Weeek rejected the request",
            response.status,
            operation.method,
            url,
            payload,
          );
        }
        return payload;
      }

      if (isRetryable(response.status, replaySafe) && attempt < MAX_ATTEMPTS) {
        await this.#sleep(backoffMs(attempt));
        continue;
      }

      // A status we would have replayed for a safer method means Weeek may have acted on the
      // request before it failed, and the caller is the one who has to decide what to do about it.
      const skipped = !isRetryable(response.status, replaySafe) && isRetryable(response.status, true);
      throw new WeeekApiError(
        `Weeek responded ${response.status}${skipped ? notRetriedNote(operation.method, "server") : ""}`,
        response.status,
        operation.method,
        url,
        payload,
      );
    }

    // A response whose body failed halfway through still arrived: saying "could not reach Weeek"
    // there would describe a failure that did not happen, and for a write Weeek already applied it
    // would say the opposite of the truth.
    const cause = describeCause(lastError, this.#config.timeoutMs);
    const what =
      lastStatus === undefined
        ? `Could not reach Weeek: ${cause}`
        : `Weeek responded ${lastStatus}, but the body could not be read: ${cause}`;

    // The cause goes into the message and nowhere else: describeApiError reads details as a Weeek
    // body, and an Error has a .message of its own, which it would print as a second line.
    const note = replaySafe ? "" : notRetriedNote(operation.method, transportReason(lastError, lastStatus));
    const failure = new WeeekApiError(
      `${what}${note}`,
      lastStatus ?? 0,
      operation.method,
      url,
      undefined,
    );
    failure.cause = lastError;
    throw failure;
  }

  #buildUrl(operation: WeeekOperation, options: RequestOptions): string {
    const pathParams = options.pathParams ?? {};
    const path = operation.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = pathParams[key];
      if (value === undefined || value === "") {
        // Failing here names the caller's mistake; sent with the placeholder still in the url, the
        // request would come back as a Weeek error that says nothing about a missing parameter.
        throw new Error(
          `Missing path parameter "${key}" for ${operation.method} ${operation.path}`,
        );
      }
      return encodeURIComponent(String(value));
    });

    const query = buildQuery(options.query ?? {}).toString();
    return `${this.#config.baseUrl}${path}${query ? `?${query}` : ""}`;
  }

  #buildInit(operation: WeeekOperation, options: RequestOptions): RequestInit {
    if (options.formData && options.body !== undefined) {
      // Only one of the two can go on the wire, and dropping the other one quietly would show up
      // as Weeek ignoring half the call.
      throw new Error(
        `Both body and formData were given for ${operation.method} ${operation.path}`,
      );
    }

    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.#config.token}`,
    });

    if (options.formData) {
      // The multipart content type carries the boundary, so only fetch can set it.
      return { method: operation.method, headers, body: options.formData };
    }

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      return { method: operation.method, headers, body: JSON.stringify(options.body) };
    }

    return { method: operation.method, headers };
  }
}

function backoffMs(attempt: number): number {
  return BASE_DELAY_MS * 2 ** (attempt - 1);
}

function isRetryable(status: number, replaySafe: boolean): boolean {
  // A 429 was turned away before Weeek acted on it, so it replays safely whatever the method is.
  if (status === 429) return true;
  return RETRY_STATUSES.has(status) && replaySafe;
}

/**
 * Says that the failure was left alone on purpose and that the outcome is unknown. Without it the
 * caller reads a plain error, calls the tool again, and becomes the retry loop this guard removed.
 */
function notRetriedNote(method: string, reason: "server" | "transport" | "timeout"): string {
  const outcome = {
    server: "Weeek may have applied it before failing",
    transport: "it may have reached Weeek anyway",
    timeout: "the timeout was ours, so Weeek may have processed it regardless",
  }[reason];

  return (
    `. It was not retried, because replaying a ${method} could apply it twice, and ${outcome}.` +
    " Check the current state before sending it again."
  );
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/** A failure that carries a status got a response, so Weeek did see the request. */
function transportReason(error: unknown, status: number | undefined): "server" | "transport" | "timeout" {
  if (status !== undefined) return "server";
  return isTimeout(error) ? "timeout" : "transport";
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  // PATCH /tm/tasks/{id} answers 405 with an HTML page, so the body is parsed only when it
  // claims to be JSON, and a broken JSON body is kept as text rather than lost.
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (text === "") return null;

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

/** Weeek can reject a call with HTTP 200; comments answer without success, so only false counts. */
function isRejection(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === "object" &&
    (payload as Record<string, unknown>)["success"] === false
  );
}

function describeCause(error: unknown, timeoutMs: number): string {
  if (isTimeout(error)) return `timed out after ${timeoutMs} ms`;
  if (!(error instanceof Error)) return String(error);

  // Node's fetch reports every network failure as a bare "fetch failed" and keeps the reason a
  // user can act on — ENOTFOUND, ECONNREFUSED, an expired certificate — one level down in cause.
  const reason = error.cause instanceof Error ? error.cause.message : "";
  return reason === "" || error.message.includes(reason)
    ? error.message
    : `${error.message}: ${reason}`;
}
