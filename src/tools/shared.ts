import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { WeeekClient } from "../http/client.ts";
import { WeeekApiError, describeApiError } from "../http/quirks.ts";
import type { WorkspaceDirectory } from "../weeek/directory.ts";

/** Everything a tool is allowed to reach: the API, the names the workspace goes by, and the one
 * directory the attachment tools may touch — null when the operator has named none, which is the
 * default and makes both of those paths refuse. */
export type ToolContext = {
  client: WeeekClient;
  directory: WorkspaceDirectory;
  fileRoot: string | null;
  /**
   * What to say about a file root wide enough to be worth mentioning, or null when there is
   * nothing to say. Carried here rather than recomputed because config.ts reads the environment
   * once, at startup, and that is worth keeping true.
   */
  fileRootWarning: string | null;
};

/**
 * What every tool that only reads says about itself.
 *
 * readOnlyHint is what spares the user a confirmation prompt per call, and lets a client run
 * several of these at once. openWorldHint is false on every tool in this server, writes included:
 * an open world means unbounded interaction, a web search, and this is one workspace behind one
 * fixed API. The distinction is not cosmetic — a client that reads the world as open asks the user
 * to approve each call by hand, and readOnlyHint only answers that question for the tools that read.
 *
 * Every read tool aliases this one object rather than declaring its own, so it is const rather than
 * merely typed: assigning to a field through one alias would change what all the others claim about
 * themselves. `satisfies` is what keeps the type checked while the value stays exact.
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

/**
 * What every tool that writes says about itself.
 *
 * All three fields are stated, and all three are false. The gate a Codex client applies is:
 *
 *     destructiveHint === true  → always ask the user
 *     readOnlyHint === true     → never ask
 *     otherwise                 → ask when (destructiveHint ?? true) || (openWorldHint ?? true)
 *
 * A write tool that declares nothing falls into that last line with both defaults, and its user
 * confirms every single call by hand. So does one that declares only the first two: leaving
 * openWorldHint out costs exactly as much as leaving all three out, which is why it is written
 * here rather than left to a default that reads "unbounded interaction with the outside world" —
 * this is one workspace behind one fixed API, the same closed world the read tools declare.
 *
 * destructiveHint is false because none of these destroys anything: creating adds, updating
 * changes named fields, moving relocates, completing is undone by the same tool with
 * completed: false, a person taken off a task can be put back, and posting a comment or attaching
 * a file only ever adds one. weeek_get_attachment is here too, though it only reads from Weeek —
 * it writes a file to this machine, which is a change to its environment and so not read-only, and
 * it destroys nothing because it refuses to replace a file rather than overwriting one.
 * weeek_delete_comment, the one tool in this server that does destroy, declares itself destructive
 * instead — see DESTRUCTIVE_ANNOTATIONS below.
 *
 * idempotentHint is deliberately absent rather than true. Completing a task twice looks like a
 * no-op and is not one: when the task repeats, each completion makes Weeek create the next
 * occurrence, so a client that replayed the call on that promise would leave a second task behind.
 * Posting the same comment twice leaves the thread holding it twice, with no way to edit either
 * one away, which is the same answer for a different reason.
 *
 * Shared by every tool that changes anything, so it is const for the reason READ_ONLY_ANNOTATIONS
 * is.
 */
export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

/**
 * What weeek_delete_comment says about itself, and it is the only tool here that says it.
 *
 * The one field that differs from WRITE_ANNOTATIONS is destructiveHint, and the difference is the
 * whole point: under the gate described above, destructiveHint: true is the branch that always
 * asks the user, whatever the other two fields say. Every call is confirmed by hand.
 *
 * That cost is the intent, not an oversight to be tidied away later into "consistency" with the
 * other writes. Weeek offers no way to edit a comment and no way to restore a deleted one, so
 * there is nothing to fall back on: a comment removed by a misread id is gone, and its text only
 * survives if someone happens to still have it on screen. Every other write in this server can be
 * walked back by another call to the same tool. This one cannot, so the human sees it first.
 *
 * idempotentHint is left out rather than set true. It would be defensible — the comment is equally
 * gone after the second call — but no client reads it here: the destructive branch has already
 * decided the prompt, and nothing else consults it. Stating a hint that changes no behaviour would
 * only invite a client to replay a call whose replay reports "Model not found" for a deletion that
 * in fact succeeded.
 */
export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

/**
 * The schema every Weeek id is declared with.
 *
 * The bounds are written out rather than left to `.int()` alone, which renders as the safe-integer
 * range — `"minimum":-9007199254740991,"maximum":9007199254740991` — in the JSON Schema every
 * client is handed on every request. These are about a third fewer characters, and unlike that
 * range they are true: a Weeek id is positive and fits in 32 bits, so this is validation rather
 * than decoration.
 */
export function weeekId(): z.ZodNumber {
  return z.number().int().min(1).max(2147483647);
}

/**
 * An optional argument that also accepts null at parse time, and reads null as though the argument
 * had not been given at all — **without declaring that in the schema.**
 *
 * Live, `weeek_add_comment` with `parentId: null` came back "expected number, received null". But
 * null is how a model says "this comment has no parent", and the whole meaning of an optional
 * argument is that its absence is ordinary — so the one spelling of absence a model reaches for
 * first was the one spelling refused. The rule is the same everywhere this is used: **null means
 * exactly what leaving the argument out means.**
 *
 * Collapsing it to undefined, rather than merely permitting it, is what makes that true. Every
 * handler in this server decides on `!== undefined` — deliberately, because `completed: false` and
 * `priority: 0` are values a caller meant and truthiness would throw both away. A schema that only
 * widened to `.nullable()` would let null reach those tests, where it is not undefined, and each
 * one would forward it to Weeek as a filter or a body field. Collapsing at the edge leaves all of
 * them correct without a line changed, and there is one place to read the rule.
 *
 * **Why the tolerance is not declared, which is the whole design.** `.nullable()` is the obvious
 * spelling and it was the first one shipped. It cost 1 120 characters across these forty
 * arguments — measured, 15 515 against 14 395 — because zod renders a nullable as
 * `anyOf: [{…}, {"type": "null"}]` and there is no lever to make it render anything shorter. The
 * SDK's ListTools handler calls `z4mini.toJSONSchema` itself passing only `target` and `io`, so
 * zod's own `override` hook — which does produce the compact `type: ["integer", "null"]`, about a
 * third the size — cannot be reached from `registerTool`, and no JSON Schema target emits the
 * compact form on its own. **Declared nullability in this SDK therefore costs roughly four times
 * what its semantics are worth, because the encoding is the library's choice and we have no say
 * in it.** That is paid on every model turn of every session, since tool descriptions sit in
 * context permanently, whereas a refused null costs one retry and only when a model actually sends
 * one. So the tolerance is kept and the declaration is dropped: this form costs nothing at all.
 *
 * The schema is then less than truthful — it says `integer` and accepts null — and that is
 * accepted deliberately, because the untruth runs in the permissive direction. A model that never
 * sends null is unaffected; one that does is served. Nobody is steered toward a wrong result,
 * which is the exact opposite of the strictness finding, where an invisible boundary produced a
 * silently wrong answer. The one way it could ever bite is a client that validated arguments
 * against the schema before sending; the MCP SDK's client does not, and for one that did the
 * effect would be the old behaviour, not a new fault.
 *
 * **`z.preprocess`, and not `.catch(undefined)`.** The latter would also let null through, and it
 * would swallow a string where a number belongs and call it "not given" — reintroducing exactly
 * the silently-dropped argument that making these shapes strict was meant to end. Only null is
 * mapped here; everything else reaches the schema, so a wrong type and an out-of-range number are
 * both still errors.
 *
 * **Field level only — never wrap the whole object.** `z.preprocess` around a `z.strictObject`
 * makes `normalizeObjectSchema` return undefined, the SDK falls back to `EMPTY_OBJECT_JSON_SCHEMA`,
 * and the tool is served as `{"type": "object", "properties": {}}` with every argument gone.
 *
 * **weeek_update_task does not use this, and must not.** Null already means something louder
 * there: a PUT of `{"dueDate": null}` empties the field, which is the only way to clear one, and
 * each of those five arguments says so in words — so on that tool null is declared, `anyOf` and
 * all, and the five are worth their 95 characters. Collapsing null to undefined would turn every
 * such call into a no-op that still answers success — a field the model asked to clear, left as it
 * was, reported as done. `title` and `tags` there stay strict for the reason the schema refuses a
 * description on that tool: null is not a state anybody wants a task in, and refusing says so.
 */
export function nullAsAbsent<Schema extends z.ZodType>(schema: Schema) {
  // Only null, and only null: anything else goes through to the schema untouched, so a string
  // where a number belongs is still a validation error rather than a silently dropped argument.
  return z.preprocess((value) => (value === null ? undefined : value), schema.optional());
}

// One definition, in the layer that has to own it: quirks.ts needs it for describeApiError and
// cannot import from here. Re-exported so a tool still finds it where it finds everything else.
export { asRecord } from "../http/quirks.ts";

/**
 * Answers with the value as JSON, deliberately unindented.
 *
 * Nothing human reads this channel, and `null, 2` spends about a third of the answer on
 * indentation — some 2 700 characters on a default 25-row page and 10 600 on a full one, measured
 * against a typical row. That is more, on a single search, than this server's whole tool set costs
 * to describe, and the tool set is why this project curates 13 tools instead of generating 157.
 */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * Answers with a failure: what Weeek said about it, and optionally a line about what had already
 * happened when it struck.
 *
 * That second line is what a tool spending several requests needs. Weeek's answer describes the
 * one call that failed and can say nothing about the ones around it, so a task left half changed
 * would reach the model as a bare error with no way to tell which half survived.
 */
export function errorResult(error: unknown, trail?: string): CallToolResult {
  const reported =
    error instanceof WeeekApiError
      ? describeApiError(error)
      : error instanceof Error
        ? error.message
        : String(error);

  // Appended rather than folded into the message: describeApiError prints the fields Weeek
  // rejected under the first line, and this belongs after them, not between them.
  const text = trail === undefined ? reported : `${reported}\n${trail}`;
  return { isError: true, content: [{ type: "text", text }] };
}

/**
 * Wraps a tool handler so that a failed call is reported in full.
 *
 * The SDK catches a thrown error already, but it answers with `error.message` and nothing else,
 * and for a WeeekApiError that message is as thin as "Weeek responded 422". What the model needs
 * to fix its call — which field Weeek rejected and what it said about it — lives in `details`,
 * and only describeApiError renders it. So the handler answers rather than throws.
 */
export async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    return errorResult(error);
  }
}
