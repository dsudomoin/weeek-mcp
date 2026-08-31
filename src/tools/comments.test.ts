import { test } from "node:test";
import assert from "node:assert/strict";
import { WeeekApiError } from "../http/quirks.ts";
import {
  type Call,
  captureTool as capture,
  captureTools,
  comment,
  connectedServer,
  payloadOf,
  textOf,
  thread,
  toolContext,
} from "../testing/tools.ts";
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
} from "./shared.ts";
import { registerCommentWriteTools, registerListCommentsTool } from "./comments.ts";

// The wire order: newest first, which is the one order the rendered thread must not be in.
const THREAD = thread();

// The same two comments once the tree is built, sorted and the authors are named: oldest at the
// root, the reply indented under it, both bodies quoted. Written out here rather than shared with
// get-task.test.ts on purpose — the two files asserting it independently is what makes "the thread
// reads the same on its own as it does inside the card" mean anything.
const RENDERED_THREAD = [
  "#1 — Denis S, 2026-08-22T10:00:00Z",
  "> text 1",
  "",
  "  #2 — Anna K, 2026-08-22T11:00:00Z",
  "  > text 2",
].join("\n");

function captureTool(commentsResponse: unknown, calls: Call[] = []) {
  return capture(
    registerListCommentsTool,
    toolContext({ "/tm/tasks/{taskId}/comments": commentsResponse }, calls),
  );
}

function commentsCall(calls: Call[]): Call | undefined {
  return calls.find((call) => call.path === "/tm/tasks/{taskId}/comments");
}

test("the thread reads the same as it does inside the card", async () => {
  const payload = payloadOf(
    await captureTool({ comments: THREAD, hasMore: false }).handler({ taskId: 7197 }),
  );

  assert.equal(payload["comments"], RENDERED_THREAD);
});

test("fifty comments from the top is what an unasked-for page means", async () => {
  const calls: Call[] = [];
  await captureTool({ comments: [], hasMore: false }, calls).handler({ taskId: 7197 });

  const call = commentsCall(calls);
  assert.equal(call?.options.pathParams?.["taskId"], 7197);
  assert.equal(call?.options.query?.["limit"], 50);
  assert.equal(call?.options.query?.["offset"], 0);
});

test("a page that was asked for is the page that is fetched", async () => {
  const calls: Call[] = [];
  await captureTool({ comments: [], hasMore: false }, calls).handler({
    taskId: 7197,
    limit: 20,
    offset: 40,
  });

  assert.equal(commentsCall(calls)?.options.query?.["limit"], 20);
  assert.equal(commentsCall(calls)?.options.query?.["offset"], 40);
});

test("more comments behind the page turn into the call that reaches them", async () => {
  // Worded the way weeek_search_tasks words the same thing: a model that only sees hasMore tends
  // to repeat the call it just made. Reading on from here reads further back, so it says so.
  const payload = payloadOf(
    await captureTool({ comments: THREAD, hasMore: true }).handler({
      taskId: 7197,
      limit: 20,
      offset: 40,
    }),
  );

  assert.equal(payload["hasMore"], true);
  assert.equal(
    payload["nextPage"],
    "older comments remain — call weeek_list_comments(taskId: 7197, offset: 60), which also " +
      "reaches any parent marked as not on this page",
  );
});

test("a page marked with 1 rather than true still pages on", async () => {
  const payload = payloadOf(
    await captureTool({ comments: THREAD, hasMore: 1 }).handler({ taskId: 7197 }),
  );

  assert.equal(payload["hasMore"], true);
  assert.match(String(payload["nextPage"]), /offset: 50/);
});

test("the end of the thread carries no call to go on with", async () => {
  const payload = payloadOf(
    await captureTool({ comments: THREAD, hasMore: false }).handler({ taskId: 7197 }),
  );

  assert.equal(payload["hasMore"], false);
  assert.equal("nextPage" in payload, false);
});

test("a task nobody has commented on answers with an empty thread, not an error", async () => {
  const payload = payloadOf(
    await captureTool({ comments: [], hasMore: false }).handler({ taskId: 7197 }),
  );

  assert.equal(payload["comments"], "");
  assert.equal(payload["hasMore"], false);
});

test("a task that does not exist is answered with what Weeek said, not thrown", async () => {
  // Weeek answers 400 "Model not found" for a missing task rather than 404. Unguarded, this would
  // reach the client as a bare protocol error with none of what Weeek said about it.
  const failing = new WeeekApiError("Weeek responded 400", 400, "GET", "https://api/comments", {
    success: false,
    code: 1000001,
    message: "Model not found",
  });

  const result = await captureTool(failing).handler({ taskId: 1 });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Model not found \(code 1000001\)/);
});

test("the tool registers under its name and says it only reads", () => {
  const captured = captureTool({ comments: [], hasMore: false });

  assert.equal(captured.name, "weeek_list_comments");
  assert.deepEqual(captured.config.annotations, READ_ONLY_ANNOTATIONS);
});

const CREATE_PATH = "/tm/tasks/{taskId}/comments";
const DELETE_PATH = "/tm/tasks/{taskId}/comments/{commentId}";

function captureWriteTools(responses: Record<string, unknown>, calls: Call[] = []) {
  return captureTools(registerCommentWriteTools, toolContext(responses, calls));
}

// Each of the two is stubbed on its own endpoint. Creating and listing share a path and differ
// only by method, which the stub does not look at; deleting has a path of its own, and stubbing
// the wrong one is how a test for a refused deletion quietly passes on a deletion that succeeded.
function writeTool(name: string, path: string, response: unknown, calls: Call[]) {
  const tool = captureWriteTools({ [path]: response }, calls).get(name);
  assert.ok(tool !== undefined, `${name} did not register`);
  return tool;
}

function addComment(response: unknown, calls: Call[] = []) {
  return writeTool("weeek_add_comment", CREATE_PATH, response, calls);
}

function deleteComment(response: unknown, calls: Call[] = []) {
  return writeTool("weeek_delete_comment", DELETE_PATH, response, calls);
}

// Everything a comment can be that a converter would ruin: hard newlines, a list, a link, code.
const MARKDOWN = [
  "Looked into it:",
  "",
  "- [the ticket](https://example.test/1)",
  "",
  "```ts",
  "const x = 1;",
  "```",
].join("\n");

test("the markdown is posted to the task exactly as it was written", async () => {
  // Weeek stores a comment as markdown and keeps it faithfully, so nothing converts it. A task
  // description is the opposite — HTML on the wire — and running a comment through that converter
  // would post the HTML source as the visible text of the comment.
  const calls: Call[] = [];
  await addComment({ comment: comment(9, null, "u-me", "2026-08-22T12:00:00Z") }, calls).handler({
    taskId: 7197,
    markdown: MARKDOWN,
  });

  const call = calls.find((made) => made.path === CREATE_PATH);
  assert.equal(call?.options.pathParams?.["taskId"], 7197);
  assert.deepEqual(call?.options.body, { markdown: MARKDOWN });
});

test("a reply carries the comment it answers, and a new thread carries no parent at all", async () => {
  const replied: Call[] = [];
  await addComment({}, replied).handler({ taskId: 7197, markdown: "ok", parentId: 41 });
  assert.deepEqual(replied.at(-1)?.options.body, { markdown: "ok", parentId: 41 });

  // Absent rather than null: both say "no parent" to Weeek, and every other body here omits.
  const rooted: Call[] = [];
  await addComment({}, rooted).handler({ taskId: 7197, markdown: "ok" });
  assert.equal("parentId" in (rooted.at(-1)?.options.body as object), false);
});

test("the comment that was created comes back with the task it was left on", async () => {
  const payload = payloadOf(
    await addComment({ comment: comment(9, 1, "u-me", "2026-08-22T12:00:00Z") }).handler({
      taskId: 7197,
      markdown: "ok",
    }),
  );

  // The id above all: it is what weeek_delete_comment and a reply both need, and nothing else in
  // the answer can be used to find it.
  assert.deepEqual(payload, {
    id: 9,
    parentId: 1,
    taskId: 7197,
    createdAt: "2026-08-22T12:00:00Z",
    added: true,
  });
});

test("the text the model just wrote is not read back to it", async () => {
  // Weeek echoes the whole comment, markdown included. Returning that spends a long comment twice
  // to tell the model what it supplied a moment earlier, and a comment can be very long.
  const payload = payloadOf(
    await addComment({
      comment: { ...comment(9, null, "u-me", "2026-08-22T12:00:00Z"), markdown: MARKDOWN },
    }).handler({ taskId: 7197, markdown: MARKDOWN }),
  );

  assert.equal("markdown" in payload, false);
  assert.equal("authorId" in payload, false);
  assert.equal("updatedAt" in payload, false);
});

test("added is on the answer whether or not Weeek described the comment", async () => {
  // A flag a model learns from one call and finds undefined on the next reads as a failure at the
  // moment everything went right.
  const described = payloadOf(
    await addComment({ comment: comment(9, null, "u-me", "2026-08-22T12:00:00Z") }).handler({
      taskId: 7197,
      markdown: "ok",
    }),
  );
  const bare = payloadOf(await addComment({}).handler({ taskId: 7197, markdown: "ok" }));

  assert.equal(described["added"], true);
  assert.equal(bare["added"], true);
});

test("a comment that was posted is never reported as one that was not", async () => {
  // The whole reason this path does not unwrap the envelope. Told the write failed, a model posts
  // the same text again, and a comment can be neither edited nor merged away afterwards. So an
  // answer that does not carry the comment costs the id and nothing more.
  const payload = payloadOf(await addComment({ success: true }).handler({
    taskId: 7197,
    markdown: "ok",
  }));

  assert.equal(payload["added"], true);
  assert.equal(payload["taskId"], 7197);
  assert.match(String(payload["note"]), /weeek_list_comments/);
});

test("a comment Weeek refused is reported with what it said", async () => {
  const failing = new WeeekApiError("Weeek responded 422", 422, "POST", "https://api/comments", {
    success: false,
    errors: { parentId: ["The selected parentId is invalid."] },
  });

  const result = await addComment(failing).handler({ taskId: 7197, markdown: "ok", parentId: 1 });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /parentId: The selected parentId is invalid\./);
});

test("deleting names both the task and the comment, and reads nothing back", async () => {
  // Weeek answers 204 with an empty body. Anything here that reached into that body for a field
  // would turn every successful deletion into a reported failure.
  const calls: Call[] = [];
  const payload = payloadOf(
    await deleteComment({}, calls).handler({ taskId: 7197, commentId: 41 }),
  );

  const call = calls.find((made) => made.path === DELETE_PATH);
  assert.deepEqual(call?.options.pathParams, { taskId: 7197, commentId: 41 });
  assert.deepEqual(payload, { taskId: 7197, commentId: 41, deleted: true });
});

test("a deletion Weeek refused is reported rather than claimed", async () => {
  const failing = new WeeekApiError("Weeek responded 400", 400, "DELETE", "https://api/c/41", {
    success: false,
    code: 1000001,
    message: "Model not found",
  });

  const result = await deleteComment(failing).handler({ taskId: 7197, commentId: 41 });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Model not found \(code 1000001\)/);
});

test("writing is an ordinary write, and deleting is the one call that asks first", () => {
  const tools = captureWriteTools({});

  assert.deepEqual([...tools.keys()], ["weeek_add_comment", "weeek_delete_comment"]);
  assert.deepEqual(tools.get("weeek_add_comment")?.config.annotations, WRITE_ANNOTATIONS);
  // Not WRITE_ANNOTATIONS, and the difference is the point: destructiveHint true is what makes a
  // Codex client ask the user before every deletion. There is no undo behind it.
  assert.deepEqual(tools.get("weeek_delete_comment")?.config.annotations, DESTRUCTIVE_ANNOTATIONS);
});

test("parentId: null posts a top-level comment instead of being refused", async () => {
  // Observed live: this call came back "expected number, received null". null is how a model says
  // a comment has no parent, and refusing it spent a round trip teaching it to omit the argument
  // instead. It goes through the real server because the coercion is the SDK parsing the schema —
  // calling the handler directly would prove nothing about what a client can send.
  const calls: Call[] = [];
  const server = await connectedServer(
    toolContext({ [CREATE_PATH]: { comment: comment(9, null, "u-me", "2026-08-22T12:00:00Z") } }, calls),
  );

  const result = await server.call("weeek_add_comment", {
    taskId: 7197,
    markdown: "top level",
    parentId: null,
  });
  await server.close();

  assert.notEqual(result.isError, true, textOf(result));
  const call = calls.find((made) => made.path === CREATE_PATH);
  // Not `parentId: null` on the wire: null meant the argument was not given, so Weeek is sent the
  // body it would have got had it been left out.
  assert.deepEqual(call?.options.body, { markdown: "top level" });
});

test("an argument nobody declared is refused instead of being thrown away", async () => {
  // The finding this replaced a pin for. Live, weeek_search_tasks called with {projectId, limit: 3}
  // answered with twenty-five tasks: the argument is perPage, `limit` was not in the schema, and
  // zod's default object silently strips what it does not know. The call succeeded, the model never
  // learned its argument had been discarded, and the context this server exists to save was spent
  // on twenty-two rows nobody asked for.
  //
  // Through the real server because the refusal is the SDK parsing the schema. captureTools calls
  // the handler directly, so a test written that way would pass whether the shape was strict or not
  // — the whole point of the finding was that the declared shape and the enforced one had come
  // apart.
  const calls: Call[] = [];
  const server = await connectedServer(
    toolContext({ [CREATE_PATH]: { comment: comment(9, null, "u-me", "2026-08-22T12:00:00Z") } }, calls),
  );

  const result = await server.call("weeek_add_comment", {
    taskId: 7197,
    markdown: "hello",
    text: "the argument this tool does not have",
  });

  assert.equal(result.isError, true, "the unknown argument was accepted");
  // Named, not merely refused: the model has to be able to tell which argument was wrong, and the
  // fix — read the schema, use `markdown` — follows from the name alone.
  assert.match(textOf(result), /Unrecognized key/);
  assert.match(textOf(result), /text/);
  // Nothing reached Weeek. Validation runs before the handler, so the comment was never posted.
  assert.equal(calls.some((made) => made.path === CREATE_PATH), false);

  // The other half, and the half that tells strictness from a tool that is simply broken: the same
  // call with only declared arguments still goes through untouched.
  const good = await server.call("weeek_add_comment", { taskId: 7197, markdown: "hello" });
  await server.close();

  assert.notEqual(good.isError, true, textOf(good));
  assert.deepEqual(calls.find((made) => made.path === CREATE_PATH)?.options.body, {
    markdown: "hello",
  });
});

test("a null argument and an unknown one fail differently, and say which is which", async () => {
  // Strictness and null-tolerance both decide before the handler runs, and they are opposite
  // answers to superficially similar calls. A model that cannot tell the two errors apart learns
  // the wrong lesson from each: that null is forbidden, or that a misspelt argument was a type
  // problem.
  const calls: Call[] = [];
  const server = await connectedServer(
    toolContext({ [CREATE_PATH]: { comment: comment(9, null, "u-me", "2026-08-22T12:00:00Z") } }, calls),
  );

  // null on a declared optional argument: accepted, and means the argument was not given.
  const nulled = await server.call("weeek_add_comment", {
    taskId: 7197,
    markdown: "top level",
    parentId: null,
  });
  // An argument that does not exist: refused, whatever its value.
  const unknown = await server.call("weeek_add_comment", {
    taskId: 7197,
    markdown: "top level",
    parent: null,
  });
  await server.close();

  assert.notEqual(nulled.isError, true, textOf(nulled));
  assert.equal(unknown.isError, true, "an undeclared argument was accepted because it was null");
  assert.match(textOf(unknown), /Unrecognized key/);
  assert.match(textOf(unknown), /parent/);
  // The two must not be confused for one another: the accepted call posted a comment, and the
  // refused one names the argument rather than complaining about its type.
  assert.doesNotMatch(textOf(unknown), /expected number/);
  assert.equal(calls.filter((made) => made.path === CREATE_PATH).length, 1);
});
