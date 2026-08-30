import { test } from "node:test";
import assert from "node:assert/strict";
import { WeeekApiError } from "../http/quirks.ts";
import {
  type Call,
  captureTool as capture,
  comment,
  payloadOf,
  textOf,
  thread,
  toolContext,
} from "../testing/tools.ts";
import { READ_ONLY_ANNOTATIONS, type ToolContext } from "./shared.ts";
import { commentsHint, loadComments, registerGetTaskTool } from "./get-task.ts";

function captureTool(context: ToolContext) {
  return capture(registerGetTaskTool, context);
}

function commentsAnswering(response: unknown, calls: Call[] = []): ToolContext {
  return toolContext({ "/tm/tasks/{taskId}/comments": response }, calls);
}

// The wire order: newest first, which is the one order the rendered thread must not be in.
const THREAD = thread();

test("a truncated thread says how to reach the rest of it", () => {
  // Without this the model has no way to tell that part of the discussion is hidden: the card
  // looks complete, and the oldest comment on the page reads as the first thing anyone said.
  const hint = commentsHint(true, 7197, 20, 0);

  assert.match(hint ?? "", /weeek_list_comments/);
  assert.match(hint ?? "", /taskId: 7197/);
  assert.match(hint ?? "", /offset: 20/);
});

test("the offset it names is past the page in hand, not past the first page", () => {
  // The trap the offset argument removes: naming `offset: limit` is right only from page zero,
  // and weeek_list_comments pages from anywhere. Getting this wrong hands back a page that skips
  // comments nobody has seen — a silent loss dressed up as paging.
  assert.match(commentsHint(true, 7197, 20, 40) ?? "", /offset: 60/);
});

test("a thread that fits carries no hint at all", () => {
  assert.equal(commentsHint(false, 7197, 20, 0), null);
});

test("the hint also answers the reply whose parent the page cut off", () => {
  // renderCommentTree marks such a reply but cannot say where its parent went. A parent is always
  // older than its reply and the pages run newest first, so a missing parent is always further
  // back — which makes this hint, present whenever hasMore is, the answer to that mark too.
  assert.match(commentsHint(true, 7197, 20, 0) ?? "", /parent/);
});

test("the hint and the mark on an orphaned reply call it the same thing", async () => {
  // The mark and the hint are written in two different modules and a model reads them as one
  // sentence: the mark says a parent is not on this page, the hint says what to call to get it.
  // Worded apart, they drift, and the second stops visibly answering the first.
  const context = commentsAnswering({
    comments: [comment(5, 99, "u-2", "2026-08-22T10:00:00Z")],
    hasMore: true,
  });

  const { rendered } = await loadComments(context, 7197, 20, 0);

  assert.match(rendered, /not on this page/);
  assert.match(commentsHint(true, 7197, 20, 0) ?? "", /not on this page/);
});

test("a thread is read chronologically, with its authors named and replies nested", async () => {
  const context = commentsAnswering({ comments: THREAD, hasMore: false });

  const { rendered } = await loadComments(context, 7197, 20, 0);

  // Resolving authorId is the single thing that makes a thread readable: on the wire every one of
  // these lines carries a bare uuid.
  assert.equal(
    rendered,
    [
      "#1 — Denis S, 2026-08-22T10:00:00Z",
      "> text 1",
      "",
      "  #2 — Anna K, 2026-08-22T11:00:00Z",
      "  > text 2",
    ].join("\n"),
  );
});

test("an author nobody can name keeps the uuid rather than losing the comment", async () => {
  const context = commentsAnswering({
    comments: [comment(1, null, "u-gone", "2026-08-22T10:00:00Z")],
    hasMore: false,
  });

  assert.match((await loadComments(context, 7197, 20, 0)).rendered, /#1 — u-gone,/);
});

test("the task, the page size and the offset all reach the request", async () => {
  const calls: Call[] = [];
  const context = commentsAnswering({ comments: [], hasMore: false }, calls);

  await loadComments(context, 7197, 20, 40);

  const call = calls.find((entry) => entry.path === "/tm/tasks/{taskId}/comments");
  assert.equal(call?.options.pathParams?.["taskId"], 7197);
  assert.equal(call?.options.query?.["limit"], 20);
  assert.equal(call?.options.query?.["offset"], 40);
});

test("hasMore is read in both the forms a Weeek flag arrives in", async () => {
  // This endpoint answers with a real boolean today, but Weeek's query side takes booleans only as
  // 1/0. If that habit ever crossed over, a strict === true would drop the hint from a page that
  // has more behind it — a silent truncation, which is the one failure this tool cannot have.
  for (const wire of [true, 1]) {
    const context = commentsAnswering({ comments: [], hasMore: wire });
    assert.equal((await loadComments(context, 7197, 20, 0)).hasMore, true, `hasMore: ${wire}`);
  }

  const last = commentsAnswering({ comments: [], hasMore: false });
  assert.equal((await loadComments(last, 7197, 20, 0)).hasMore, false);
});

test("a discussion of many authors still costs one directory load", async () => {
  // The names are resolved from a snapshot taken once, not looked up per comment. Per author this
  // would be five requests each, and a long thread would spend a hundred of them on names alone.
  const calls: Call[] = [];
  const authors = Array.from({ length: 20 }, (_unused, index) =>
    comment(index + 1, null, `u-${index}`, `2026-08-22T10:00:${String(index).padStart(2, "0")}Z`),
  );
  const context = commentsAnswering({ comments: authors, hasMore: false }, calls);

  await loadComments(context, 7197, 20, 0);

  assert.equal(calls.filter((entry) => entry.path === "/user/me").length, 1);
  assert.equal(calls.length, 6);
});

test("a comments response missing its own field is reported, not rendered as empty", async () => {
  // This is the one endpoint with no success envelope, so a body that carries neither is the shape
  // to worry about: read leniently it would answer "no comments" for a task that has a discussion.
  const context = commentsAnswering({ hasMore: false });

  await assert.rejects(loadComments(context, 7197, 20, 0), /has no "comments" field/);
});

const TASK = {
  id: 7197,
  title: "Vampirism",
  description: "<p>ship it <strong>today</strong></p><p>second line</p>",
  priority: 2,
  tags: [51],
  assignees: ["u-2", "u-me", "u-gone"],
  isCompleted: false,
};

function taskContext(responses: Record<string, unknown> = {}, calls: Call[] = []): ToolContext {
  return toolContext(
    {
      "/tm/tasks/{id}": { success: true, task: TASK },
      "/tm/tasks/{taskId}/comments": { comments: THREAD, hasMore: false },
      ...responses,
    },
    calls,
  );
}

test("the card builds the directory once, though three things ask it for names", async () => {
  // loadComments asks, the handler asks for the assignee names, and tagTitles asks again. The
  // dedup that makes those one request lives in WorkspaceDirectory#pending; losing it would put
  // ten workspace requests behind the most-used tool in this server with every test still green.
  const calls: Call[] = [];
  await captureTool(taskContext({}, calls)).handler({ taskId: 7197 });

  assert.equal(calls.filter((call) => call.path === "/user/me").length, 1);
  // Five for the directory, one for the task, one for its comments.
  assert.equal(calls.length, 7);
});

test("the card reads the description as markdown, names the priority and the tags", async () => {
  const payload = payloadOf(await captureTool(taskContext()).handler({ taskId: 7197 }));

  // Weeek stores a description as HTML, and a model reads markdown.
  assert.equal(payload["description"], "ship it **today**\n\nsecond line");
  assert.equal(payload["priorityLabel"], "high");
  assert.deepEqual(payload["tagTitles"], ["bug"]);
  assert.equal(payload["title"], "Vampirism");
});

test("the card carries the discussion, read chronologically and with names", async () => {
  const payload = payloadOf(await captureTool(taskContext()).handler({ taskId: 7197 }));

  assert.match(String(payload["comments"]), /^#1 — Denis S,/);
  assert.match(String(payload["comments"]), /#2 — Anna K,/);
  assert.equal(payload["commentsHint"], null);
});

test("a thread longer than the page says so, in the terms of the tool that finishes it", async () => {
  const context = taskContext({
    "/tm/tasks/{taskId}/comments": { comments: THREAD, hasMore: true },
  });

  const payload = payloadOf(await captureTool(context).handler({ taskId: 7197 }));

  assert.match(String(payload["commentsHint"]), /weeek_list_comments\(taskId: 7197, offset: 20\)/);
});

test("each endpoint gets the task id under the name its own path spells it with", async () => {
  // /tm/tasks/{id} and /tm/tasks/{taskId}/comments disagree about that name, and getting one wrong
  // is not a 422 but a request that never leaves: buildUrl throws on an unfilled placeholder.
  const calls: Call[] = [];
  await captureTool(taskContext({}, calls)).handler({ taskId: 7197 });

  const task = calls.find((call) => call.path === "/tm/tasks/{id}");
  assert.equal(task?.options.pathParams?.["id"], 7197);
  assert.equal(
    calls.find((call) => call.path === "/tm/tasks/{taskId}/comments")?.options.pathParams?.[
      "taskId"
    ],
    7197,
  );
});

test("the card names the people on it, and keeps their ids too", async () => {
  // This is the card a model reads before reassigning or mentioning someone, and on the wire every
  // one of these is a bare uuid — the search rows name the same people. The ids stay beside the
  // names because weeek_set_task_people takes ids, and an id nobody can name stays itself.
  const payload = payloadOf(await captureTool(taskContext()).handler({ taskId: 7197 }));

  assert.deepEqual(payload["assigneeNames"], ["Anna K", "Denis S", "u-gone"]);
  assert.deepEqual(payload["assignees"], ["u-2", "u-me", "u-gone"]);
});

test("a task with nobody on it names nobody", async () => {
  const context = taskContext({
    "/tm/tasks/{id}": { success: true, task: { id: 7197, title: "Vampirism" } },
  });

  const payload = payloadOf(await captureTool(context).handler({ taskId: 7197 }));

  assert.deepEqual(payload["assigneeNames"], []);
  assert.deepEqual(payload["tagTitles"], []);
});

test("a truncated thread says so when Weeek marks it with 1 rather than true", async () => {
  // The regression this closes: === true here leaves every other test in this file green while
  // the second half of a discussion goes missing. Nothing pinned it at the tool's own boundary.
  const context = taskContext({
    "/tm/tasks/{taskId}/comments": { comments: THREAD, hasMore: 1 },
  });

  const payload = payloadOf(await captureTool(context).handler({ taskId: 7197 }));

  assert.match(String(payload["commentsHint"]), /offset: 20/);
});

test("a tag id that is not one is not passed off to the directory as a tag", async () => {
  // Nothing is lost by dropping it — the raw tags ride through the card untouched — but a title
  // resolved from something that is not an id would read as a tag that exists and does not.
  const context = taskContext({
    "/tm/tasks/{id}": { success: true, task: { ...TASK, tags: [51, "51", null] } },
  });

  const payload = payloadOf(await captureTool(context).handler({ taskId: 7197 }));

  assert.deepEqual(payload["tagTitles"], ["bug"]);
  assert.deepEqual(payload["tags"], [51, "51", null]);
});

test("the default page of comments is twenty, and a given one is used instead", async () => {
  const calls: Call[] = [];
  await captureTool(taskContext({}, calls)).handler({ taskId: 7197 });
  assert.equal(commentsQuery(calls)?.["limit"], 20);

  const own: Call[] = [];
  await captureTool(taskContext({}, own)).handler({ taskId: 7197, commentsLimit: 100 });
  assert.equal(commentsQuery(own)?.["limit"], 100);
});

function commentsQuery(calls: Call[]): Record<string, unknown> | undefined {
  return calls.find((call) => call.path === "/tm/tasks/{taskId}/comments")?.options.query;
}

test("includeComments false asks Weeek for no comments at all", async () => {
  // Not fetched and then dropped: the point of the flag is the request it saves.
  const calls: Call[] = [];
  const payload = payloadOf(
    await captureTool(taskContext({}, calls)).handler({ taskId: 7197, includeComments: false }),
  );

  assert.equal(commentsQuery(calls), undefined);
  assert.equal("comments" in payload, false);
  assert.equal("commentsHint" in payload, false);
  assert.equal(payload["title"], "Vampirism");
});

test("comments are on unless they are turned off", async () => {
  const calls: Call[] = [];
  await captureTool(taskContext({}, calls)).handler({ taskId: 7197, includeComments: true });
  assert.notEqual(commentsQuery(calls), undefined);
});

test("a task that does not exist is answered with what Weeek said, not thrown", async () => {
  // Weeek answers 400 with "Model not found" for a missing task, not 404, and that body carries
  // code/message rather than the errors map — the shape describeApiError has to render.
  const failing = new WeeekApiError("Weeek responded 400", 400, "GET", "https://api/tasks/1", {
    success: false,
    code: 1000001,
    message: "Model not found",
  });

  const result = await captureTool(taskContext({ "/tm/tasks/{id}": failing })).handler({ taskId: 1 });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Model not found \(code 1000001\)/);
});

test("the tool registers under its name and says it only reads", () => {
  const captured = captureTool(taskContext());

  assert.equal(captured.name, "weeek_get_task");
  assert.deepEqual(captured.config.annotations, READ_ONLY_ANNOTATIONS);
});
