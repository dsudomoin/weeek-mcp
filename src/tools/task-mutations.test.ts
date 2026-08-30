import { test } from "node:test";
import assert from "node:assert/strict";
import { WeeekApiError } from "../http/quirks.ts";
import {
  type Call,
  captureTools,
  connectedServer,
  payloadOf,
  shapeOf,
  textOf,
  toolContext,
} from "../testing/tools.ts";
import { WRITE_ANNOTATIONS } from "./shared.ts";
import {
  UPDATE_SHAPE,
  buildCreateTaskBody,
  registerTaskMutationTools,
} from "./task-mutations.ts";

/** One of the five tools, over a client that answers the paths a test names. */
function tool(name: string, responses: Record<string, unknown> = {}, calls: Call[] = []) {
  const tools = captureTools(registerTaskMutationTools, toolContext(responses, calls));
  const found = tools.get(name);
  assert.ok(found !== undefined, `${name} did not register itself`);
  return found;
}

function describedBy(shape: Record<string, unknown>, field: string): string {
  return (shape[field] as { description?: string } | undefined)?.description ?? "";
}

function bodyOf(calls: readonly Call[], path: string): Record<string, unknown> {
  const call = calls.find((entry) => entry.path === path);
  assert.ok(call !== undefined, `nothing was sent to ${path}`);
  return call.options.body as Record<string, unknown>;
}

/** A 400 with the two-field shape Weeek uses for everything that is not a validation failure. */
function modelNotFound(): WeeekApiError {
  return new WeeekApiError("Weeek responded 400", 400, "POST", "https://api/tm/tasks/7361", {
    success: false,
    code: 1000001,
    message: "Model not found",
  });
}

const CREATED = { success: true, task: { id: 7361, title: "t" } };
// Weeek stores a description as HTML, so this is what a card comes back looking like.
const CARD_IN_HTML = {
  success: true,
  task: { id: 7361, title: "t", description: "<p><b>hi</b></p>" },
};

test("a description reaches Weeek as HTML with its line breaks intact", () => {
  // Weeek drops bare newlines and stores the description as HTML, so two paragraphs sent as text
  // arrive as one run-on line. This is the conversion that keeps them apart.
  const body = buildCreateTaskBody({
    title: "release checklist",
    projectId: 1,
    description: "first\nsecond",
  });

  assert.match(String(body["description"]), /<br\s*\/?>/);
});

test("a fenced code block is sent in the one shape Weeek keeps", () => {
  // A <pre><code> block is deleted whole by Weeek's normaliser, and marked emits exactly that.
  // Pinned here because a hand-rolled markdown conversion would pass every other test in this file.
  const html = String(
    buildCreateTaskBody({
      title: "t",
      projectId: 1,
      description: "```\nconst answer = 1;\n```",
    })["description"],
  );

  assert.match(html, /<p><code>/);
  assert.doesNotMatch(html, /<pre>/);
});

test("a task with no description sends no description field", () => {
  const body = buildCreateTaskBody({ title: "t", projectId: 1 });
  assert.equal("description" in body, false);
});

test("the project and the column travel in locations", () => {
  const body = buildCreateTaskBody({ title: "t", projectId: 1, boardColumnId: 802 });
  assert.deepEqual(body["locations"], [{ projectId: 1, boardColumnId: 802 }]);
});

test("a task with no column still sends a valid locations entry", () => {
  const body = buildCreateTaskBody({ title: "t", projectId: 1 });
  assert.deepEqual(body["locations"], [{ projectId: 1, boardColumnId: null }]);
});

test("the optional fields travel only when they were given", () => {
  const bare = buildCreateTaskBody({ title: "t", projectId: 1 });
  assert.deepEqual(Object.keys(bare).sort(), ["locations", "title"]);

  const full = buildCreateTaskBody({
    title: "t",
    projectId: 1,
    parentId: 7000,
    priority: 2,
    type: "meet",
  });
  assert.equal(full["parentId"], 7000);
  assert.equal(full["priority"], 2);
  assert.equal(full["type"], "meet");
});

test("priority 0 is sent rather than dropped for being falsy", () => {
  // 0 is the lowest priority and a caller who asks for it means it. A truthiness check here
  // silently turns "low" into "whatever Weeek defaults to".
  assert.equal(buildCreateTaskBody({ title: "t", projectId: 1, priority: 0 })["priority"], 0);
});

test("creating a task answers with the task Weeek made", async () => {
  const calls: Call[] = [];
  const { handler } = tool("weeek_create_task", { "/tm/tasks": CREATED }, calls);

  const payload = payloadOf(await handler({ title: "t", projectId: 1, boardColumnId: 802 }));

  assert.equal(payload["id"], 7361);
  assert.deepEqual(bodyOf(calls, "/tm/tasks"), {
    title: "t",
    locations: [{ projectId: 1, boardColumnId: 802 }],
  });
});

test("a create Weeek answered without a card still reports what happened", async () => {
  // Both endpoints do return the task today. What this pins is the answer if one ever stops:
  // read through unwrapEnvelope, an unexpected body becomes "Weeek response has no task field",
  // so a task that was created is reported as a failure — and the model's recovery is to send the
  // create again, which leaves a second task behind.
  const result = await tool("weeek_create_task", { "/tm/tasks": { success: true } }).handler({
    title: "t",
    projectId: 1,
  });

  assert.notEqual(result.isError, true);
  assert.match(textOf(result), /weeek_search_tasks/);
});

test("a rejected create reports what Weeek said about it", async () => {
  const result = await tool("weeek_create_task", { "/tm/tasks": modelNotFound() }).handler({
    title: "t",
    projectId: 1,
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Model not found/);
});

test("an update sends only the fields it was given", async () => {
  const calls: Call[] = [];
  const { handler } = tool("weeek_update_task", { "/tm/tasks/{id}": CREATED }, calls);

  await handler({ taskId: 7361, title: "renamed", priority: 0, tags: [51] });

  assert.deepEqual(bodyOf(calls, "/tm/tasks/{id}"), {
    title: "renamed",
    priority: 0,
    tags: [51],
  });
  const update = calls.find((entry) => entry.path === "/tm/tasks/{id}");
  assert.equal(update?.options.pathParams?.["id"], 7361);
});

test("an update never sends a description, whatever it is handed", async () => {
  // The SDK strips an unknown argument before a handler sees it, so this only proves anything
  // because the handler is called raw. What it pins is that the body is built from a fixed list of
  // fields rather than spread from the arguments — the field Weeek accepts and then ignores can
  // never reach the wire, not even from a caller that goes around the schema.
  const calls: Call[] = [];
  const { handler } = tool("weeek_update_task", { "/tm/tasks/{id}": CREATED }, calls);

  await handler({ taskId: 7361, title: "renamed", description: "written off" });

  assert.deepEqual(bodyOf(calls, "/tm/tasks/{id}"), { title: "renamed" });
});

test("the schemas say where a description and a tag can and cannot be set", async () => {
  // The whole design of these two tools: absent from the schema is what a model cannot attempt.
  // The two fields are asymmetric in opposite directions, both verified on the wire — a
  // description sent to update is ignored, and tags sent to create come back empty.
  const create = shapeOf(tool("weeek_create_task").config);
  const update = shapeOf(tool("weeek_update_task").config);

  assert.equal("description" in create, true);
  assert.equal("description" in update, false);
  assert.equal("tags" in create, false);
  assert.equal("tags" in update, true);
});

test("an update with no fields is refused before a request goes out", async () => {
  const calls: Call[] = [];
  const result = await tool("weeek_update_task", {}, calls).handler({ taskId: 7361 });

  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("an update Weeek answered without a card still reports success", async () => {
  const result = await tool("weeek_update_task", { "/tm/tasks/{id}": { success: true } }).handler({
    taskId: 7361,
    title: "renamed",
  });

  assert.notEqual(result.isError, true);
  const payload = payloadOf(result);
  assert.equal(payload["taskId"], 7361);
  assert.deepEqual(payload["fields"], ["title"]);
});

test("a move changes the board before the column", async () => {
  // A column id belongs to a board: sent the other way round, the column is set on the old board
  // and then thrown away by the move that follows.
  const calls: Call[] = [];
  await tool("weeek_move_task", {}, calls).handler({
    taskId: 7361,
    boardId: 143,
    boardColumnId: 802,
  });

  assert.deepEqual(
    calls.map((entry) => entry.path),
    ["/tm/tasks/{id}/board", "/tm/tasks/{id}/board-column"],
  );
  assert.deepEqual(bodyOf(calls, "/tm/tasks/{id}/board"), { boardId: 143 });
  assert.deepEqual(bodyOf(calls, "/tm/tasks/{id}/board-column"), { boardColumnId: 802 });
});

test("a move to a column alone leaves the board where it is", async () => {
  const calls: Call[] = [];
  await tool("weeek_move_task", {}, calls).handler({ taskId: 7361, boardColumnId: 802 });

  assert.deepEqual(
    calls.map((entry) => entry.path),
    ["/tm/tasks/{id}/board-column"],
  );
});

test("a move answers with the destination it actually changed", async () => {
  const payload = payloadOf(
    await tool("weeek_move_task").handler({ taskId: 7361, boardColumnId: 802 }),
  );

  assert.deepEqual(payload, { taskId: 7361, boardColumnId: 802, moved: true });
});

test("a move with neither destination is refused before a request goes out", async () => {
  const calls: Call[] = [];
  const result = await tool("weeek_move_task", {}, calls).handler({ taskId: 7361 });

  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("a move that changed the board and then failed says what already happened", async () => {
  // Weeek's own error names neither the board that did move nor the column that did not. Without
  // that, the task is on a new board in whatever column it landed in, and the model is told only
  // that something went wrong.
  const result = await tool("weeek_move_task", {
    "/tm/tasks/{id}/board-column": modelNotFound(),
  }).handler({ taskId: 7361, boardId: 143, boardColumnId: 802 });

  assert.equal(result.isError, true);
  const text = textOf(result);
  assert.match(text, /Applied before it failed: board\./);
  // Weeek's own detail survives the trail being attached to it.
  assert.match(text, /Model not found/);
});

test("completing and reopening go to their own endpoints", async () => {
  const calls: Call[] = [];
  const { handler } = tool("weeek_complete_task", {}, calls);

  await handler({ taskId: 7361, completed: true });
  await handler({ taskId: 7361, completed: false });

  assert.deepEqual(
    calls.map((entry) => entry.path),
    ["/tm/tasks/{id}/complete", "/tm/tasks/{id}/un-complete"],
  );
});

test("a completion that spawned the next occurrence says so", async () => {
  // Weeek creates the next occurrence of a recurring task on its own. Unreported, that task
  // appears in the tracker with nothing in the conversation to account for it.
  const result = await tool("weeek_complete_task", {
    "/tm/tasks/{id}/complete": { success: true, repeatedTask: { id: 7362 }, repeatType: "week" },
  }).handler({ taskId: 7361, completed: true });

  assert.match(String(payloadOf(result)["note"]), /7362/);
});

test("a completion of a task that does not repeat says nothing about occurrences", async () => {
  const result = await tool("weeek_complete_task", {
    "/tm/tasks/{id}/complete": { success: true, repeatedTask: null, repeatType: null },
  }).handler({ taskId: 7361, completed: true });

  const payload = payloadOf(result);
  assert.equal("note" in payload, false);
  assert.equal(payload["taskId"], 7361);
  assert.equal(payload["completed"], true);
});

test("a completion Weeek answered in plain text is passed through, not spread apart", async () => {
  // parseBody hands back a string whenever the answer does not claim to be JSON — Weeek's 405 is
  // an HTML page, and complete is the one endpoint whose body the spec declares as text/plain.
  // Spread into the answer, a string becomes {"0":"o","1":"k"}.
  const payload = payloadOf(
    await tool("weeek_complete_task", { "/tm/tasks/{id}/complete": "ok" }).handler({
      taskId: 7361,
      completed: true,
    }),
  );

  assert.deepEqual(payload, { taskId: 7361, completed: true, changed: true });
});

test("the tags parameter says the list is replaced, not added to", async () => {
  // Proved on the wire: a task tagged [51, 52] sent {"tags":[24]} ends up tagged [24]. There is
  // no per-tag endpoint anywhere in the API — unlike assignees and watchers, which have
  // POST/DELETE pairs — so a model told to "add the bug tag", sending one id, silently destroys
  // every other tag on the task. The parameter has to say so; nothing else can.
  const tags = describedBy(shapeOf(tool("weeek_update_task").config), "tags");

  assert.match(tags, /replaces/);
  assert.match(tags, /weeek_get_task/);
});

test("create says where tags and people are set, since they cannot be set there", async () => {
  // A task created for someone, with tags, comes back unassigned and untagged. Neither is an
  // error, so the only thing that can send the model on to the second call is this text.
  const description = tool("weeek_create_task").config.description ?? "";

  assert.match(description, /weeek_update_task/);
  assert.match(description, /weeek_set_task_people/);
});

test("null clears a field rather than being dropped on the way out", async () => {
  // Without this a due date can be set and never removed: the model tries null, zod rejects it,
  // and there is no other move. Weeek clears the field on null and answers 200.
  const calls: Call[] = [];
  const { handler } = tool("weeek_update_task", { "/tm/tasks/{id}": CREATED }, calls);

  await handler({ taskId: 7361, dueDate: null, priority: null });

  assert.deepEqual(bodyOf(calls, "/tm/tasks/{id}"), { dueDate: null, priority: null });
});

test("the schema takes null to clear a date but not an empty string", () => {
  assert.equal(UPDATE_SHAPE["dueDate"].safeParse(null).success, true);
  assert.equal(UPDATE_SHAPE["dueDate"].safeParse("2026-09-15").success, true);
  // "" is not a date and Weeek would answer 422 for it; it never leaves.
  assert.equal(UPDATE_SHAPE["dueDate"].safeParse("").success, false);
});

test("every field that takes null says so, and a title cannot be cleared at all", async () => {
  // zod constraints do not reach the model in Codex, so "you may send null" exists only if it is
  // written in prose — otherwise a model finds the capability by guessing, which is the situation
  // .nullable() was added to end. Title is deliberately not among them: a task with no title is
  // unreadable everywhere it appears, and the schema is where what should not be attempted is
  // prevented, exactly as with description on this tool and tags on create.
  const update = shapeOf(tool("weeek_update_task").config);

  for (const field of ["priority", "type", "startDate", "dueDate", "duration"] as const) {
    assert.equal(UPDATE_SHAPE[field].safeParse(null).success, true, field);
    assert.match(describedBy(update, field), /Send null to clear it\./, field);
  }

  assert.equal(UPDATE_SHAPE["title"].safeParse(null).success, false);
  assert.equal(UPDATE_SHAPE["title"].safeParse("still named").success, true);
  assert.doesNotMatch(describedBy(update, "title"), /null/);
});

test("every field the update schema advertises reaches the body", async () => {
  // The invariant the whitelist rests on, and its one boundary: taskId names the task in the path
  // and is the only advertised key that is not a body field. A field advertised and never sent is
  // the silent no-op this tool exists to remove, so the list is read back from the schema the tool
  // actually registered rather than from UPDATE_SHAPE — that way a field declared beside the
  // shape, which the shape itself cannot prevent, fails here too.
  const calls: Call[] = [];
  const captured = tool("weeek_update_task", { "/tm/tasks/{id}": CREATED }, calls);
  const advertised = Object.keys(shapeOf(captured.config));

  await captured.handler(
    Object.fromEntries(advertised.map((field) => [field, field === "taskId" ? 7361 : "x"])),
  );

  assert.deepEqual(
    Object.keys(bodyOf(calls, "/tm/tasks/{id}")).sort(),
    advertised.filter((field) => field !== "taskId").sort(),
  );
});

test("a created task comes back with its description as markdown", async () => {
  // Weeek stores a description as HTML. Every read tool converts it back; without this, a model
  // that wrote markdown gets Weeek's HTML echoed at it as though that were what it had sent.
  const payload = payloadOf(
    await tool("weeek_create_task", { "/tm/tasks": CARD_IN_HTML }).handler({
      title: "t",
      projectId: 1,
      description: "**hi**",
    }),
  );

  assert.equal(payload["description"], "**hi**");
});

test("an updated task comes back with its description as markdown too", async () => {
  const payload = payloadOf(
    await tool("weeek_update_task", { "/tm/tasks/{id}": CARD_IN_HTML }).handler({
      taskId: 7361,
      title: "t",
    }),
  );

  assert.equal(payload["description"], "**hi**");
});

test("reopening a task says nothing about a new occurrence", async () => {
  // Weeek creates the next occurrence when a recurring task is completed, not when it is
  // reopened. Announcing one on the way back would be an invention.
  const payload = payloadOf(
    await tool("weeek_complete_task", {
      "/tm/tasks/{id}/un-complete": { success: true, repeatedTask: { id: 7362 } },
    }).handler({ taskId: 7361, completed: false }),
  );

  assert.equal("note" in payload, false);
});

test("a falsy repeatedTask is not a task that was created", async () => {
  // null is the only value ever captured, but false, 0 and "" all mean the same nothing, and each
  // of them would otherwise be announced as a task that now exists.
  for (const wire of [false, 0, ""]) {
    const payload = payloadOf(
      await tool("weeek_complete_task", {
        "/tm/tasks/{id}/complete": { success: true, repeatedTask: wire },
      }).handler({ taskId: 7361, completed: true }),
    );

    assert.equal("note" in payload, false, `repeatedTask: ${JSON.stringify(wire)}`);
  }
});

test("what the tool knows about the call outlives what the payload claims", async () => {
  // The payload is passed through, so it must not be able to overwrite the two things this answer
  // is about. success goes: a call that failed never reaches here, so it says nothing.
  const payload = payloadOf(
    await tool("weeek_complete_task", {
      "/tm/tasks/{id}/complete": {
        success: true,
        taskId: 999,
        completed: false,
        repeatType: "week",
      },
    }).handler({ taskId: 7361, completed: true }),
  );

  assert.equal(payload["taskId"], 7361);
  assert.equal(payload["completed"], true);
  assert.equal("success" in payload, false);
  assert.equal(payload["repeatType"], "week");
});

test("each list of people goes to its own endpoint with the task id", async () => {
  const calls: Call[] = [];
  await tool("weeek_set_task_people", {}, calls).handler({
    taskId: 7361,
    addAssignees: ["u-2"],
    removeAssignees: ["u-3"],
    addWatchers: ["u-4"],
    removeWatchers: ["u-5"],
  });

  assert.deepEqual(
    calls.map((entry) => entry.path),
    [
      "/tm/tasks/{taskId}/assignees",
      "/tm/tasks/{taskId}/assignees",
      "/tm/tasks/{task_id}/watchers",
      "/tm/tasks/{task_id}/watchers",
    ],
  );
  // The two endpoints name the task differently, and a path parameter that is not filled in is
  // not a Weeek error — it is our own, raised before the request leaves.
  assert.equal(calls[0]?.options.pathParams?.["taskId"], 7361);
  assert.equal(calls[2]?.options.pathParams?.["task_id"], 7361);
  assert.deepEqual(calls[0]?.options.body, { assignees: ["u-2"] });
  assert.deepEqual(calls[2]?.options.body, { watchers: ["u-4"] });
});

test("only the lists that carry someone are sent", async () => {
  const calls: Call[] = [];
  const result = await tool("weeek_set_task_people", {}, calls).handler({
    taskId: 7361,
    addAssignees: ["u-2"],
    removeWatchers: [],
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(payloadOf(result)["applied"], ["addAssignees"]);
});

test("a call with no one in any list is refused before a request goes out", async () => {
  const calls: Call[] = [];
  const result = await tool("weeek_set_task_people", {}, calls).handler({ taskId: 7361 });

  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("people half applied says what landed and what was never tried", async () => {
  // Four requests, one error. Which of them already changed the task is the only thing that tells
  // the model whether it can send the call again, and Weeek's answer to the failed one cannot
  // say anything about the three around it.
  const calls: Call[] = [];
  const result = await tool(
    "weeek_set_task_people",
    { "/tm/tasks/{task_id}/watchers": modelNotFound() },
    calls,
  ).handler({
    taskId: 7361,
    addAssignees: ["u-2"],
    removeAssignees: ["u-3"],
    addWatchers: ["u-4"],
    removeWatchers: ["u-5"],
  });

  assert.equal(result.isError, true);
  const text = textOf(result);
  assert.match(text, /Applied before it failed: addAssignees, removeAssignees\./);
  assert.match(text, /Not attempted: removeWatchers\./);
  assert.match(text, /Model not found/);
  // It stopped at the failure rather than sending the last request anyway.
  assert.equal(calls.length, 3);
});

test("a failure on the first step says the task is untouched", async () => {
  const result = await tool("weeek_set_task_people", {
    "/tm/tasks/{taskId}/assignees": modelNotFound(),
  }).handler({ taskId: 7361, addAssignees: ["u-2"], addWatchers: ["u-4"] });

  assert.match(textOf(result), /Nothing was applied before it failed\./);
});

test("all five register, and every one says it writes without destroying", async () => {
  // The gate a Codex client applies: destructiveHint true always prompts, readOnlyHint true never
  // does, and anything else prompts when destructive or openWorld defaults to true. A write tool
  // that declares nothing therefore makes the user confirm every single call by hand.
  const tools = captureTools(registerTaskMutationTools, toolContext());

  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      "weeek_complete_task",
      "weeek_create_task",
      "weeek_move_task",
      "weeek_set_task_people",
      "weeek_update_task",
    ],
  );

  for (const [name, captured] of tools) {
    assert.equal(captured.config.annotations, WRITE_ANNOTATIONS, name);
  }
});

/** A card the way Weeek answers one: ids for everything a person would read as a name. */
const CARD_WITH_IDS = {
  success: true,
  task: { id: 7361, title: "t", priority: 2, tags: [51], assignees: ["u-2"] },
};

test("every write answers the outcome question, on the success branch as well", async () => {
  // The rule is already written down twice, in comments.ts and attachments.ts: a flag a model
  // learns from one call and finds undefined on the next reads as a failure exactly when
  // everything went right. These three tools did not follow it, and nothing was stopping them.
  const created = payloadOf(
    await tool("weeek_create_task", { "/tm/tasks": CARD_WITH_IDS }).handler({
      title: "t",
      projectId: 1,
    }),
  );
  assert.equal(created["created"], true);

  const updated = payloadOf(
    await tool("weeek_update_task", { "/tm/tasks/{id}": CARD_WITH_IDS }).handler({
      taskId: 7361,
      title: "renamed",
    }),
  );
  assert.equal(updated["updated"], true);

  const assigned = payloadOf(
    await tool("weeek_set_task_people", { "/tm/tasks/{taskId}/assignees": { success: true } })
      .handler({ taskId: 7361, addAssignees: ["u-2"] }),
  );
  assert.equal(assigned["changed"], true);
  // Beside the flag, not replaced by it: `applied` answers which calls went out, which is the
  // question that matters when only some of them did.
  assert.deepEqual(assigned["applied"], ["addAssignees"]);
});

test("weeek_update_task names the task the same way whichever branch answers", async () => {
  // It used to say `id` on success and `taskId` when degraded, so a model reading an id back had
  // to know both spellings while ever seeing only one of them per call.
  const full = payloadOf(
    await tool("weeek_update_task", { "/tm/tasks/{id}": CARD_WITH_IDS }).handler({
      taskId: 7361,
      title: "renamed",
    }),
  );
  const degraded = payloadOf(
    await tool("weeek_update_task", { "/tm/tasks/{id}": { success: true } }).handler({
      taskId: 7361,
      title: "renamed",
    }),
  );

  assert.equal(full["taskId"], 7361);
  assert.equal(degraded["taskId"], 7361);
  assert.equal(full["updated"], degraded["updated"]);
});

test("a mutation answers the same card a read does, names resolved", async () => {
  // weeek_update_task replaces the whole tag list — this project's most destructive trap — and it
  // was the one tool whose answer showed tags as bare ids. A model that had just rewritten a list
  // could not read back what it had done without a second call to weeek_get_task.
  const payload = payloadOf(
    await tool("weeek_update_task", { "/tm/tasks/{id}": CARD_WITH_IDS }).handler({
      taskId: 7361,
      tags: [51],
    }),
  );

  assert.deepEqual(payload["tagTitles"], ["bug"]);
  assert.deepEqual(payload["assigneeNames"], ["Anna K"]);
  assert.equal(payload["priorityLabel"], "high");
  // Beside the raw ids, never instead of them: weeek_set_task_people takes the ids.
  assert.deepEqual(payload["tags"], [51]);
  assert.deepEqual(payload["assignees"], ["u-2"]);
});

test("the outcome flag never shares a name with an argument echoed back", async () => {
  // weeek_complete_task echoes its own `completed` argument, and once every other write started
  // answering <verb>ed: true for "it worked", that echo landed in the slot that now means success.
  // A reopen succeeds and echoes completed: false — a report of failure, under the pattern the
  // rest of the tool set teaches. So the outcome gets a name the argument cannot collide with.
  const reopened = payloadOf(
    await tool("weeek_complete_task", { "/tm/tasks/{id}/un-complete": { success: true } }).handler({
      taskId: 7361,
      completed: false,
    }),
  );

  assert.equal(reopened["changed"], true);
  // The echo stays — it says which direction was asked for, which is worth having.
  assert.equal(reopened["completed"], false);

  const completed = payloadOf(
    await tool("weeek_complete_task", { "/tm/tasks/{id}/complete": { success: true } }).handler({
      taskId: 7361,
      completed: true,
    }),
  );
  assert.equal(completed["changed"], true);
  assert.equal(completed["completed"], true);
});

test("a call that only removes people does not answer that it assigned any", async () => {
  // `assigned: true` was true of the common call and false of two others: this one, and any call
  // touching watchers alone. A flag that overstates is the same fault as a schema that does —
  // smaller, but the same — so the neutral verb carries the outcome and the precise ones stay
  // where they are accurate.
  const removed = payloadOf(
    await tool("weeek_set_task_people", { "/tm/tasks/{taskId}/assignees": { success: true } })
      .handler({ taskId: 7361, removeAssignees: ["u-2"] }),
  );
  const watchersOnly = payloadOf(
    await tool("weeek_set_task_people", { "/tm/tasks/{task_id}/watchers": { success: true } })
      .handler({ taskId: 7361, addWatchers: ["u-2"] }),
  );

  for (const payload of [removed, watchersOnly]) {
    assert.equal(payload["changed"], true);
    assert.equal("assigned" in payload, false);
  }
  assert.deepEqual(removed["applied"], ["removeAssignees"]);
  assert.deepEqual(watchersOnly["applied"], ["addWatchers"]);
});

test("null still clears a field on update rather than being read as an absent argument", async () => {
  // The exception to the rule every other tool now follows, and the reason it is an exception: on
  // this one tool null is a value Weeek acts on. Were weeek_update_task to collapse null to "not
  // given" like the rest, this call would send an empty body — a due date the model asked to clear,
  // left as it was, reported as cleared. Through the real server, because a handler called
  // directly never runs the schema that would have done the collapsing.
  const calls: Call[] = [];
  const server = await connectedServer(
    toolContext({ "/tm/tasks/{id}": { success: true, task: { id: 7197, title: "t" } } }, calls),
  );

  const result = await server.call("weeek_update_task", { taskId: 7197, dueDate: null });
  await server.close();

  assert.notEqual(result.isError, true, textOf(result));
  assert.deepEqual(bodyOf(calls, "/tm/tasks/{id}"), { dueDate: null });
});

test("null on create means the argument was not given", async () => {
  const calls: Call[] = [];
  const server = await connectedServer(
    toolContext({ "/tm/tasks": { success: true, task: { id: 7197, title: "t" } } }, calls),
  );

  const result = await server.call("weeek_create_task", {
    title: "t",
    projectId: 1,
    parentId: null,
    description: null,
    priority: null,
  });
  await server.close();

  assert.notEqual(result.isError, true, textOf(result));
  // boardColumnId is null inside locations because that is the shape Weeek takes, not because a
  // null argument survived: the three arguments that were null are simply absent from the body.
  assert.deepEqual(bodyOf(calls, "/tm/tasks"), {
    title: "t",
    locations: [{ projectId: 1, boardColumnId: null }],
  });
});
