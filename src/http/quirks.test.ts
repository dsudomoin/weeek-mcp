import { test } from "node:test";
import assert from "node:assert/strict";
import { WeeekApiError, buildQuery, describeApiError, toApiDate, unwrapEnvelope } from "./quirks.ts";

test("booleans become 1 and 0, never true and false", () => {
  // GET /tm/tasks?all=true answers 422 "The all field must be true or false", while all=1 answers 200.
  assert.equal(buildQuery({ all: true }).toString(), "all=1");
  assert.equal(buildQuery({ completed: false }).toString(), "completed=0");
});

test("arrays are serialized with brackets in the key", () => {
  // GET /tm/tasks?tags=51 answers 422; only tags[]=51 is accepted.
  assert.equal(buildQuery({ tags: [51, 52] }).toString(), "tags%5B%5D=51&tags%5B%5D=52");
});

test("empty values are skipped and an empty array adds no parameter", () => {
  assert.equal(buildQuery({ a: undefined, b: null, c: [], d: 1 }).toString(), "d=1");
});

test("dates are translated to dd.mm.yyyy", () => {
  // Weeek date filters reject ISO dates and take dd.mm.yyyy.
  assert.equal(toApiDate("2026-08-28"), "28.08.2026");
  assert.equal(toApiDate("2026-08-28T13:52:05Z"), "28.08.2026");
  assert.equal(toApiDate("2026-08-28 13:52:05"), "28.08.2026");
});

test("a malformed date fails with a hint about the expected input", () => {
  assert.throws(() => toApiDate("28.08.2026"), /YYYY-MM-DD/);
  // Two concatenated dates would otherwise yield the first one, and the user would silently
  // get the wrong window: Weeek accepts the result, so nothing downstream can catch it.
  assert.throws(() => toApiDate("2026-08-28-2026-09-01"), /YYYY-MM-DD/);
  assert.throws(() => toApiDate("2026-08-2800"), /YYYY-MM-DD/);
});

test("the success envelope is unwrapped", () => {
  assert.deepEqual(unwrapEnvelope({ success: true, tasks: [1, 2] }, "tasks"), [1, 2]);
});

test("comments arrive without success, and that is not a failure", () => {
  // GET /tm/tasks/{taskId}/comments is the one endpoint that answers without a success field.
  assert.deepEqual(unwrapEnvelope({ comments: [], hasMore: false }, "comments"), []);
});

test("success:false with HTTP 200 counts as a failure", () => {
  assert.throws(
    () => unwrapEnvelope({ success: false, errors: { all: ["invalid"] } }, "tasks"),
    WeeekApiError,
  );
});

test("a missing field is a failure, not an undefined slipping downstream", () => {
  assert.throws(() => unwrapEnvelope({ success: true }, "tasks"), WeeekApiError);
  // An explicit null passes "key in record" and throws on the caller's first .map(), far from here.
  assert.throws(() => unwrapEnvelope({ success: true, tasks: null }, "tasks"), WeeekApiError);
});

test("a body that is not an object is a failure", () => {
  // A gateway in front of Weeek can answer with HTML or an empty body.
  assert.throws(() => unwrapEnvelope("<html>502</html>", "tasks"), WeeekApiError);
  assert.throws(() => unwrapEnvelope(null, "tasks"), WeeekApiError);
});

test("a validation error is readable by a human and by a model", () => {
  // Weeek reports invalid array items under dotted keys such as tags.0.
  const error = new WeeekApiError("422", 422, "GET", "https://api/tm/tasks", {
    errors: { "tags.0": ["The selected tags.0 is invalid."] },
  });
  const text = describeApiError(error);
  assert.match(text, /tags\[0\]/);
  assert.match(text, /The selected tags\.0 is invalid\./);
});

test("an error without field details still says what went wrong", () => {
  // Transport failures carry no errors object, so the message is the only information there is.
  const error = new WeeekApiError(
    "Could not reach Weeek: fetch failed",
    0,
    "GET",
    "https://api/tm/tasks",
    undefined,
  );
  assert.match(describeApiError(error), /fetch failed/);
});

test("an error raised outside a request leaves no dangling location", () => {
  // unwrapEnvelope knows no method or url; the description must not trail off mid-sentence.
  const noContext = new WeeekApiError('Weeek response has no "tasks" field', 200, "", "", {
    success: true,
  });
  assert.equal(describeApiError(noContext), 'Weeek response has no "tasks" field');

  // A method without a url would render an empty pair of parentheses.
  const noUrl = new WeeekApiError("Weeek responded 500", 500, "GET", "", undefined);
  assert.equal(describeApiError(noUrl), "Weeek responded 500");
});

test("a failure without an errors object reports code and message instead", () => {
  // Only validation failures carry an errors map; a bad token or a missing model answers
  // {success, code, message}, and those are the two failures a user hits most.
  const unauthenticated = new WeeekApiError(
    "Weeek responded 401",
    401,
    "GET",
    "https://api/user/me",
    { success: false, code: 2000000, message: "Unauthenticated." },
  );
  assert.equal(
    describeApiError(unauthenticated),
    "Weeek responded 401 (GET https://api/user/me)\n  Unauthenticated. (code 2000000)",
  );

  const missingModel = new WeeekApiError("Weeek responded 400", 400, "GET", "https://api/tm/tasks/9", {
    success: false,
    code: 1000001,
    message: "Model not found",
  });
  assert.match(describeApiError(missingModel), /Model not found/);
});
