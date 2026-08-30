import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { WeeekApiError } from "../http/quirks.ts";
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  errorResult,
  guard,
  jsonResult,
} from "./shared.ts";

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  assert.ok(first !== undefined && first.type === "text");
  return first.text;
}

test("a result carries its value as JSON text", () => {
  assert.deepEqual(JSON.parse(textOf(jsonResult({ tasks: [], hasMore: false }))), {
    tasks: [],
    hasMore: false,
  });
});

test("a rejected call is reported with what Weeek said about it", () => {
  // The SDK catches a thrown error on its own, but answers with error.message alone — here
  // "Weeek responded 422", which names neither the field nor the reason. Everything a caller
  // needs to fix the call is in details, and only this path renders it.
  const error = new WeeekApiError("Weeek responded 422", 422, "GET", "https://api/tm/tasks", {
    success: false,
    errors: { "tags.0": ["The selected tags.0 is invalid."] },
  });

  const result = errorResult(error);
  assert.equal(result.isError, true);
  assert.equal(
    textOf(result),
    "Weeek responded 422 (GET https://api/tm/tasks)\n  tags[0]: The selected tags.0 is invalid.",
  );
});

test("a failure that is not Weeek's still reports itself", () => {
  assert.equal(textOf(errorResult(new Error("socket hang up"))), "socket hang up");
  // A handler can throw something that was never an Error — a bare string, or undefined.
  assert.equal(textOf(errorResult("no")), "no");
});

test("guard answers instead of throwing, and leaves a success alone", async () => {
  const ok = await guard(async () => jsonResult({ fine: true }));
  assert.equal(ok.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(ok)), { fine: true });

  const failed = await guard(async () => {
    throw new Error("boom");
  });
  assert.equal(failed.isError, true);
  assert.equal(textOf(failed), "boom");
});

// Never called: what it pins is that the assignment does not compile. Every read tool aliases the
// same annotations object, so one of them writing to a field would quietly change what all the
// others say about themselves — npm run check is the assertion here, not a runtime one.
function annotationsAreConst(): void {
  // @ts-expect-error readOnlyHint is readonly on a const-asserted object
  READ_ONLY_ANNOTATIONS.readOnlyHint = false;
}

test("the shared annotations say read-only in a closed world", () => {
  assert.deepEqual(READ_ONLY_ANNOTATIONS, { readOnlyHint: true, openWorldHint: false });
  assert.equal(typeof annotationsAreConst, "function");
});

// Never called either, for the same reason: every tool that writes aliases this one object.
function writeAnnotationsAreConst(): void {
  // @ts-expect-error destructiveHint is readonly on a const-asserted object
  WRITE_ANNOTATIONS.destructiveHint = true;
}

test("the write annotations say every field a Codex client reads", async () => {
  // The gate: destructiveHint true always prompts, readOnlyHint true never does, and everything
  // else prompts when destructive or openWorld falls back to its default of true. So a write tool
  // that leaves any of the three out is a tool the user confirms by hand on every call.
  assert.deepEqual(WRITE_ANNOTATIONS, {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.equal(typeof writeAnnotationsAreConst, "function");
});

test("deleting a comment is the one call that asks the user first", () => {
  // The point of the whole constant is this one field: under the gate above, destructiveHint true
  // is the branch that prompts whatever the other two say. Weeek cannot edit a comment and cannot
  // restore one, so this is the only write here that nothing can walk back.
  assert.equal(DESTRUCTIVE_ANNOTATIONS.destructiveHint, true);
  assert.deepEqual(DESTRUCTIVE_ANNOTATIONS, {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  });
  // Differs from a write in that field alone — anything else diverging is a mistake, not a choice.
  assert.deepEqual(
    { ...DESTRUCTIVE_ANNOTATIONS, destructiveHint: false },
    { ...WRITE_ANNOTATIONS },
  );
});
