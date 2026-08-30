import { test } from "node:test";
import assert from "node:assert/strict";
import { type RawTask, priorityLabel, taskDescriptionMarkdown, toTaskRow } from "./tasks.ts";

// A real GET /tm/tasks row carries 39 fields, several of which the generated Task schema never
// declares. The extras are kept in the fixture so that anything riding along into a row shows up.
function rawTask(overrides: Record<string, unknown> = {}): RawTask {
  return {
    id: 7197,
    title: "[FTEnchantments] Vampirism",
    description: "<p>a very long text</p>",
    priority: 2,
    isCompleted: true,
    isDeleted: false,
    projectId: 1,
    boardId: 143,
    boardColumnId: 832,
    assignees: ["u-1"],
    subscribers: ["u-1"],
    workloads: [],
    timer: null,
    repeat: null,
    customFields: [],
    updatedAt: "2026-08-24T11:54:18Z",
    ...overrides,
  };
}

test("priorities are read as words", () => {
  assert.equal(priorityLabel(0), "low");
  assert.equal(priorityLabel(1), "medium");
  assert.equal(priorityLabel(2), "high");
  assert.equal(priorityLabel(3), "hold");
});

test("a priority outside 0-3, or none at all, has no label", () => {
  // Weeek stores null for a task nobody prioritised, and rejects a filter outside 0-3 with 422
  // "The selected priority is invalid." — so a value out of range means the shape changed, and
  // inventing a word for it would read as fact.
  assert.equal(priorityLabel(null), null);
  assert.equal(priorityLabel(undefined), null);
  assert.equal(priorityLabel(42), null);
  assert.equal(priorityLabel(-1), null);
  assert.equal(priorityLabel(1.5), null);
});

test("a description arrives as HTML and leaves as markdown", () => {
  const markdown = taskDescriptionMarkdown(rawTask({ description: "<p>first<br>second</p>" }));

  // The line break is asserted, not just the absence of tags: a conversion that dropped the <br>
  // would still answer without a single tag, and hand the model "firstsecond".
  assert.match(markdown, /^first\s*\nsecond$/);
  assert.doesNotMatch(markdown, /<p>/);
});

test("a task with no description gives an empty string", () => {
  assert.equal(taskDescriptionMarkdown(rawTask({ description: null })), "");
  assert.equal(taskDescriptionMarkdown({ id: 1, title: "t" }), "");
  // Not only null: anything that is not a string is left alone rather than stringified, which is
  // what keeps "[object Object]" out of a task card.
  assert.equal(taskDescriptionMarkdown(rawTask({ description: 42 })), "");
});

test("a row resolves assignees and does not carry the description", () => {
  const row = toTaskRow(rawTask(), () => "Anna P");

  assert.equal(row.id, 7197);
  assert.equal(row.priority, "high");
  assert.deepEqual(row.assignees, ["Anna P"]);
  assert.equal("description" in row, false);
});

test("a row is exactly the declared fields, with nothing riding along from the task", () => {
  // The description is the field this projection exists to leave out: a page of up to 100 tasks
  // with their full texts spends more context than the whole tool set costs. Every other field of
  // the raw task would cost the same way, so the row is pinned whole rather than by checking for
  // the description alone.
  const row = toTaskRow(rawTask(), (id) => id);

  assert.deepEqual(Object.keys(row).sort(), [
    "assignees",
    "boardColumnId",
    "boardId",
    "id",
    "isCompleted",
    "isDeleted",
    "priority",
    "projectId",
    "title",
    "updatedAt",
  ]);
});

test("a row carries the project and board its column id can be looked up through", () => {
  // A bare boardColumnId cannot be resolved: weeek_context needs the board, and the workspace has
  // 110 of them across 5 projects. The three ids travel together so one follow-up call suffices.
  const row = toTaskRow(rawTask(), (id) => id);

  assert.equal(row.projectId, 1);
  assert.equal(row.boardId, 143);
  assert.equal(row.boardColumnId, 832);
});

test("a deleted task says so, since a search with includeAll returns them beside live ones", () => {
  // Verified on the wire: of the first 100 tasks answered with all=1, 16 are deleted, and one of
  // those carries isCompleted: false — which is exactly the row that would read as live work.
  const deleted = toTaskRow(rawTask({ isDeleted: true, isCompleted: false }), (id) => id);

  assert.equal(deleted.isDeleted, true);
  assert.equal(deleted.isCompleted, false);
  assert.equal(toTaskRow(rawTask(), (id) => id).isDeleted, false);
});

test("a flag sent as 1 or 0 is read as the boolean it stands for", () => {
  // Weeek takes booleans only as 1/0 in a query string — that habit is why quirks.ts exists. Its
  // answers use real booleans today, but if the two sides ever meet, a strict `=== true` would
  // report a completed task as unfinished. Both forms are read, so neither can lie.
  const numeric = toTaskRow(rawTask({ isCompleted: 1, isDeleted: 0 }), (id) => id);

  assert.equal(numeric.isCompleted, true);
  assert.equal(numeric.isDeleted, false);
  // A value that is neither a boolean nor 1/0 is not guessed at: it reads as false rather than
  // turning an unknown shape into a claim that the task is done.
  assert.equal(toTaskRow(rawTask({ isCompleted: "true" }), (id) => id).isCompleted, false);
});

test("every assignee id is asked for by itself, so a row cannot come back short", () => {
  // The callback is per-id rather than per-array on purpose. A batch callback may answer with
  // fewer names than it was given, and a task assigned to someone we cannot name would then read
  // as unassigned — a wrong answer, not a missing one. Per-id, that cannot be expressed.
  const seen: string[] = [];
  const row = toTaskRow(rawTask({ assignees: ["u-1", "u-2"] }), (id) => {
    seen.push(id);
    return `name of ${id}`;
  });

  assert.deepEqual(seen, ["u-1", "u-2"]);
  assert.deepEqual(row.assignees, ["name of u-1", "name of u-2"]);
});

test("a field Weeek left out, or left null, becomes null rather than undefined", () => {
  // Not a hypothetical shape: 5 of the first 100 tasks the live workspace answers with sit in a
  // project on no board, with boardId and boardColumnId both null. undefined would drop out of the
  // JSON the tool serialises, so the field has to survive as null for the model to see it at all.
  const row = toTaskRow(
    { id: 1, title: "t", priority: null, projectId: 1, boardId: null, boardColumnId: null },
    (id) => id,
  );

  assert.deepEqual(row, {
    id: 1,
    title: "t",
    priority: null,
    isCompleted: false,
    isDeleted: false,
    projectId: 1,
    boardId: null,
    boardColumnId: null,
    assignees: [],
    updatedAt: null,
  });
});

test("an assignee that is not a string is not passed off as one", () => {
  // assignees is an array of uuid strings on the wire. An unchecked cast would put anything else
  // into a field the type promises is string[], and into the callback that resolves names.
  const row = toTaskRow(rawTask({ assignees: ["u-1", 42, null] }), (id) => id);

  assert.deepEqual(row.assignees, ["u-1"]);
});
