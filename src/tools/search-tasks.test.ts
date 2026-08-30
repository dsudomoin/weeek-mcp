import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Call,
  type Handler,
  captureTool as capture,
  connectedServer,
  payloadOf,
  textOf,
  toolContext,
} from "../testing/tools.ts";
import { OPS } from "../weeek/operations.ts";
import type { ToolContext } from "./shared.ts";
import {
  PRIORITIES,
  SEARCH_SHAPE,
  SORT_FIELDS,
  type SearchArgs,
  TASK_TYPES,
  buildSearchQuery,
  registerSearchTasksTool,
} from "./search-tasks.ts";

test("dates are translated into the format Weeek takes", () => {
  const query = buildSearchQuery({ startDate: "2026-08-01", endDate: "2026-08-31" });
  assert.equal(query["startDate"], "01.08.2026");
  assert.equal(query["endDate"], "31.08.2026");
});

test("the completion window is translated and renamed to what the API calls it", () => {
  const query = buildSearchQuery({ completedFrom: "2026-08-01", completedTo: "2026-08-31" });
  assert.equal(query["completedAtFrom"], "01.08.2026");
  assert.equal(query["completedAtTo"], "31.08.2026");
});

test("desc prepends a minus to the sort field", () => {
  assert.equal(buildSearchQuery({ sortBy: "priority", desc: true })["sortBy"], "-priority");
  assert.equal(buildSearchQuery({ sortBy: "priority" })["sortBy"], "priority");
});

test("desc on its own sorts nothing", () => {
  // Without the guard this would send "-undefined" and Weeek would answer 422.
  assert.equal(buildSearchQuery({ desc: true })["sortBy"], undefined);
});

test("the sort fields are exactly the ones the spec declares", () => {
  // `created` and `start` were once dropped from this list as invalid, on the strength of a name
  // list someone guessed at; both are accepted and really sort, and `-created` is the sort a model
  // reaches for most. Reading the enum off the spec is what keeps a guess from narrowing the tool
  // again — after update:openapi this test fails instead of the tool quietly losing a field.
  const declared = OPS.searchTasks.parameters.find((parameter) => parameter.name === "sortBy");
  assert.deepEqual([...SORT_FIELDS].sort(), [...(declared?.schema["enum"] ?? [])].sort());
});

function declaredByTheSpec(field: string): unknown[] {
  // Weeek declares both on the create-task body; the search's own query parameters are typed as a
  // bare string and integer, with the values only mentioned in prose.
  const schema = OPS.createTask.requestBody?.schema.properties?.[field];
  const values = schema?.["enum"];
  assert.ok(Array.isArray(values), `the spec no longer declares an enum for ${field}`);
  return values;
}

test("the task types are the ones the spec declares", () => {
  assert.deepEqual([...TASK_TYPES].sort(), [...declaredByTheSpec("type")].sort());
});

test("the priorities are the ones the spec declares, and the schema takes exactly those", () => {
  assert.deepEqual([...PRIORITIES], declaredByTheSpec("priority"));

  // The schema says 0 to 3 as a range, so this is what ties the range to the list above.
  for (const priority of PRIORITIES) {
    assert.equal(SEARCH_SHAPE.priority.safeParse(priority).success, true, `rejected ${priority}`);
  }
  assert.equal(SEARCH_SHAPE.priority.safeParse(PRIORITIES.length).success, false);
  assert.equal(SEARCH_SHAPE.priority.safeParse(-1).success, false);
});

// The name each argument goes out under, where it differs from its own.
const QUERY_NAMES: Record<string, string> = {
  assignee: "userId",
  includeAll: "all",
  completedFrom: "completedAtFrom",
  completedTo: "completedAtTo",
};

// desc is not a parameter of its own: it becomes the minus in front of sortBy.
const NOT_A_PARAMETER = new Set(["desc"]);

const EVERY_ARGUMENT: SearchArgs = {
  projectId: 1,
  boardId: 2,
  boardColumnId: 3,
  assignee: "u-2",
  completed: true,
  includeAll: true,
  priority: 1,
  type: "action",
  tags: [51],
  search: "vampirism",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  completedFrom: "2026-08-01",
  completedTo: "2026-08-31",
  sortBy: "created",
  desc: true,
  perPage: 10,
  offset: 20,
};

test("every declared argument reaches the query", () => {
  // Inferring SearchArgs from the shape keeps the two in step, but nothing makes buildSearchQuery
  // handle a field added to the shape: a spread is not excess-checked, so the omission compiles
  // and the filter is simply never sent. This is what notices, for the field and for the fixture.
  assert.equal(Object.keys(EVERY_ARGUMENT).length, Object.keys(SEARCH_SHAPE).length);

  const query = buildSearchQuery(EVERY_ARGUMENT);
  for (const argument of Object.keys(SEARCH_SHAPE)) {
    if (NOT_A_PARAMETER.has(argument)) continue;
    assert.ok(
      (QUERY_NAMES[argument] ?? argument) in query,
      `${argument} is declared but never reaches the query`,
    );
  }
});

test("empty filters leave only the paging defaults", () => {
  assert.deepEqual(buildSearchQuery({}), { perPage: 25, offset: 0 });
});

test("paging is taken from the arguments when given", () => {
  assert.deepEqual(buildSearchQuery({ perPage: 100, offset: 200 }), { perPage: 100, offset: 200 });
});

test("includeAll maps to all", () => {
  assert.equal(buildSearchQuery({ includeAll: true })["all"], true);
});

test("assignee maps to userId", () => {
  assert.equal(buildSearchQuery({ assignee: "u-2" })["userId"], "u-2");
});

test("completed false is a filter, not a missing one", () => {
  // A truthiness check here would drop it and answer with open and completed tasks alike —
  // the opposite of what was asked for, and silently.
  assert.equal(buildSearchQuery({ completed: false })["completed"], false);
  assert.equal(buildSearchQuery({ priority: 0 })["priority"], 0);
});

test("an empty tag list is not sent", () => {
  // buildQuery drops an empty array on its own, so no URL depends on this. What is pinned is the
  // intent: an empty tag list is no filter, and stays that way if the serializer ever changes.
  assert.equal("tags" in buildSearchQuery({ tags: [] }), false);
  assert.deepEqual(buildSearchQuery({ tags: [51, 52] })["tags"], [51, 52]);
});

function captureTool(context: ToolContext): Handler {
  return capture(registerSearchTasksTool, context).handler;
}

function searchContext(searchResponse: unknown, calls: Call[] = []): ToolContext {
  return toolContext({ "/tm/tasks": searchResponse }, calls);
}

test('"me" becomes the caller\'s own id before the search goes out', async () => {
  const calls: Call[] = [];
  const handler = captureTool(searchContext({ success: true, tasks: [], hasMore: false }, calls));

  await handler({ assignee: "me" });

  const search = calls.find((call) => call.path === "/tm/tasks");
  assert.equal(search?.options.query?.["userId"], "u-me");
});

test("rows name their assignees and carry no description", async () => {
  const handler = captureTool(
    searchContext({
      success: true,
      tasks: [
        {
          id: 7197,
          title: "Vampirism",
          description: "<p>a very long text</p>",
          priority: 2,
          isCompleted: false,
          isDeleted: false,
          assignees: ["u-2", "u-me", "u-gone"],
        },
      ],
      hasMore: false,
    }),
  );

  const rows = payloadOf(await handler({})) as { tasks: Record<string, unknown>[] };
  const row = rows.tasks[0];
  assert.ok(row !== undefined, "the search answered with no rows at all");

  // An id nobody can name stays the id, which weeek_get_task still accepts.
  assert.deepEqual(row["assignees"], ["Anna K", "Denis S", "u-gone"]);
  assert.equal("description" in row, false);
});

test("more tasks behind the page turn into the offset that fetches them", async () => {
  const handler = captureTool(searchContext({ success: true, tasks: [], hasMore: true }));

  const payload = payloadOf(await handler({ perPage: 10, offset: 20 }));
  assert.equal(payload["hasMore"], true);
  assert.match(String(payload["nextPage"]), /offset: 30/);
});

test("a page marked with 1 rather than true still pages on", async () => {
  // Left unpinned by task 9: isTrue is what reads Weeek's other boolean form, and a regression to
  // === true would drop the hint from a full page with every other test in this file still green.
  const handler = captureTool(searchContext({ success: true, tasks: [], hasMore: 1 }));

  const payload = payloadOf(await handler({ perPage: 10, offset: 20 }));

  assert.equal(payload["hasMore"], true);
  assert.match(String(payload["nextPage"]), /offset: 30/);
});

test("the last page carries no paging hint", async () => {
  const handler = captureTool(searchContext({ success: true, tasks: [], hasMore: false }));

  const payload = payloadOf(await handler({}));
  assert.equal(payload["hasMore"], false);
  assert.equal("nextPage" in payload, false);
});

test("a date in the wrong format is answered, not thrown", async () => {
  // The schema cannot express the format, so toApiDate is what rejects it — from inside the
  // handler, where an unguarded throw would reach the client as a bare protocol error.
  const handler = captureTool(searchContext({ success: true, tasks: [], hasMore: false }));

  const result = await handler({ startDate: "01.08.2026" });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Date must be in YYYY-MM-DD format, got: 01\.08\.2026/);
});

test("the four date bounds describe themselves alike, and claim no pairing", () => {
  // The claim this replaces — "Both must be given together" on startDate and endDate — was in the
  // plan, not in Weeek. Each bound filters on its own, verified live: startDate alone returned four
  // tasks, endDate alone returned none from a different range, and together they returned the same
  // four. It survived every review because prose cannot be executed, so it is pinned here.
  //
  // A false requirement does its damage the other way round from a refusal: a model that wants a
  // one-sided filter invents the companion bound to satisfy the schema, and silently changes what
  // it gets back.
  const bounds = ["startDate", "endDate", "completedFrom", "completedTo"] as const;

  for (const name of bounds) {
    assert.equal(SEARCH_SHAPE[name].description, "YYYY-MM-DD.", name);
  }

  // The regression this really guards: any wording that reads as a requirement, on any argument.
  for (const [name, field] of Object.entries(SEARCH_SHAPE)) {
    assert.doesNotMatch(
      field.description ?? "",
      /both must|must be given|requires? (a|an|the)?\s*\w*[Dd]ate/,
      `${name} describes a pairing rule the API does not have`,
    );
  }
});

test("a filter given as null filters on nothing, exactly as leaving it out does", async () => {
  // Eighteen optional filters is the shape a model fills in field by field, writing null for the
  // ones the request did not mention. Through the real server, because it is the SDK parsing the
  // schema that turns that null into an absent argument — buildSearchQuery never sees one.
  const calls: Call[] = [];
  const server = await connectedServer(
    searchContext({ success: true, tasks: [], hasMore: false }, calls),
  );

  const result = await server.call("weeek_search_tasks", {
    projectId: 11,
    assignee: null,
    completed: null,
    tags: null,
    sortBy: null,
    perPage: null,
  });
  await server.close();

  assert.notEqual(result.isError, true, textOf(result));
  const query = calls.find((call) => call.path === "/tm/tasks")?.options.query ?? {};
  assert.equal(query["projectId"], 11);
  for (const dropped of ["userId", "completed", "tags", "sortBy"]) {
    assert.ok(!(dropped in query), `${dropped} reached the query as a filter`);
  }
  // perPage is not merely dropped: null asked for the default, and the default is what goes out.
  assert.equal(query["perPage"], 25);
});

test("null on a declared argument answers exactly as leaving it out does", async () => {
  // The behaviour the schema used to declare and no longer does. Since nullAsAbsent now takes null
  // at parse time without announcing it, the schema can no longer be read to check this — only the
  // behaviour can, and only through the real server, because the coercion is the SDK parsing the
  // arguments. The two calls are compared whole: same answer, same query on the wire. Anything
  // weaker would pass while null quietly became a filter Weeek was asked to apply.
  const withNulls: Call[] = [];
  const withoutThem: Call[] = [];

  const a = await connectedServer(searchContext({ success: true, tasks: [], hasMore: false }, withNulls));
  const nulled = await a.call("weeek_search_tasks", {
    projectId: 9,
    assignee: null,
    completed: null,
    tags: null,
    sortBy: null,
    perPage: null,
    offset: null,
  });
  await a.close();

  const b = await connectedServer(searchContext({ success: true, tasks: [], hasMore: false }, withoutThem));
  const omitted = await b.call("weeek_search_tasks", { projectId: 9 });
  await b.close();

  assert.notEqual(nulled.isError, true, textOf(nulled));
  assert.equal(textOf(nulled), textOf(omitted));
  assert.deepEqual(
    withNulls.find((made) => made.path === "/tm/tasks")?.options.query,
    withoutThem.find((made) => made.path === "/tm/tasks")?.options.query,
  );
});

test("only null is forgiven — a wrong value is still refused", async () => {
  // The trap nullAsAbsent deliberately avoids. `.catch(undefined)` would also let null through and
  // would swallow every one of these as well, turning a wrong argument into a silently dropped one
  // — the exact fault that making these shapes strict existed to end. Four kinds of argument, so a
  // coercion that reached only numbers would not slip past either.
  const server = await connectedServer(searchContext({ success: true, tasks: [], hasMore: false }));

  for (const [field, value] of [
    ["perPage", "twenty"],
    ["perPage", 500],
    ["sortBy", "nonsense"],
    ["tags", ["bug"]],
  ] as const) {
    const result = await server.call("weeek_search_tasks", { projectId: 9, [field]: value });
    assert.equal(result.isError, true, `${field}: ${JSON.stringify(value)} was accepted`);
  }
  await server.close();
});
