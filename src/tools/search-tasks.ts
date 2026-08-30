import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RawTask } from "../format/tasks.ts";
import { isTrue, toTaskRow } from "../format/tasks.ts";
import type { QueryValue } from "../http/quirks.ts";
import { toApiDate, unwrapEnvelope } from "../http/quirks.ts";
import { memberNameIn } from "../weeek/directory.ts";
import { OPS } from "../weeek/operations.ts";
import {
  READ_ONLY_ANNOTATIONS,
  type ToolContext,
  guard,
  jsonResult,
  nullAsAbsent,
  weeekId,
} from "./shared.ts";

// The spec's own enum, all eight confirmed live along with their `-` forms. A field Weeek does
// not know comes back as 422 "The selected sort by is invalid." — `createdAt`, `updatedAt`, `id`,
// `day` and `title` all do, and the field the responses call `title` is called `name` here. Taking
// the list from the spec rather than from guessed names is what makes that 422 unreachable.
export const SORT_FIELDS = [
  "name",
  "type",
  "priority",
  "duration",
  "overdue",
  "created",
  "date",
  "start",
] as const;

// Both taken from the spec, which declares them on the create-task body rather than on this
// query — the query parameters are typed as a bare string and integer. Tests pin both, because a
// hand-copied list is exactly how the sort fields came to be wrong.
export const TASK_TYPES = ["action", "meet", "call"] as const;
export const PRIORITIES = [0, 1, 2, 3] as const;

// Shared by the query and by the paging hint, so the hint cannot name an offset the call did not
// actually use.
const DEFAULT_PER_PAGE = 25;
const DEFAULT_OFFSET = 0;

/**
 * The arguments, declared once.
 *
 * Codex drops every zod constraint on its way to the model — `.int()`, `.min()`, `.max()` — so
 * each bound that matters is spelled out in words too. Enums survive, and are not repeated.
 */
export const SEARCH_SHAPE = {
  projectId: nullAsAbsent(weeekId()),
  boardId: nullAsAbsent(weeekId()),
  boardColumnId: nullAsAbsent(weeekId()),
  assignee: nullAsAbsent(z.string()).describe('A member uuid, or "me" for yourself.'),
  completed: nullAsAbsent(z.boolean()).describe(
    "Only completed tasks when true, only open ones when false.",
  ),
  includeAll: nullAsAbsent(z.boolean()).describe(
    "Also return deleted and completed tasks. Deleted ones are marked isDeleted in the row. " +
      "Overrides completed when true.",
  ),
  priority: nullAsAbsent(z.number().int().min(0).max(3)).describe(
    "0 low, 1 medium, 2 high, 3 hold.",
  ),
  type: nullAsAbsent(z.enum(TASK_TYPES)),
  tags: nullAsAbsent(z.array(weeekId())).describe("Tag ids, from weeek_context."),
  search: nullAsAbsent(z.string()).describe("Matches the title and the description."),
  // All four read alike because all four behave alike: each bound filters on its own and Weeek
  // requires no pairing. These two used to claim "Both must be given together", which was invented
  // rather than observed — and the damage of a false requirement is not a refusal but the opposite,
  // a model inventing the second bound to satisfy the schema and quietly narrowing the result set.
  startDate: nullAsAbsent(z.string()).describe("YYYY-MM-DD."),
  endDate: nullAsAbsent(z.string()).describe("YYYY-MM-DD."),
  completedFrom: nullAsAbsent(z.string()).describe("YYYY-MM-DD."),
  completedTo: nullAsAbsent(z.string()).describe("YYYY-MM-DD."),
  sortBy: nullAsAbsent(z.enum(SORT_FIELDS)).describe(
    "Weeek accepts only these; anything else is rejected.",
  ),
  desc: nullAsAbsent(z.boolean()).describe("Sort descending."),
  perPage: nullAsAbsent(z.number().int().min(1).max(100)).describe("1 to 100, 25 by default."),
  offset: nullAsAbsent(
    z
      .number()
      .int()
      .min(0)
      // Bounded for the same reason ids are: without a maximum, zod renders the safe-integer one
      // into the schema, and 9007199254740991 pages of tasks is not a real number.
      .max(2147483647),
  ).describe("0 or more, for paging."),
};

// Inferred rather than restated. Two hand-kept lists of eighteen fields drift, and a spread is not
// excess-checked, so the drift compiles. `every argument reaches the query` is the test that
// catches a field added here and never mapped below.
export type SearchArgs = z.infer<z.ZodObject<typeof SEARCH_SHAPE>>;

/**
 * Turns the tool's arguments into Weeek's query parameters.
 *
 * Several of them are renamed on the way: an assignee is `userId`, "everything including deleted"
 * is `all`, and the completion window is `completedAtFrom`/`completedAtTo`. Values are left as
 * they are — `buildQuery` is what turns a boolean into 1/0 and an array into `tags[]=`.
 */
export function buildSearchQuery(args: SearchArgs): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
    offset: args.offset ?? DEFAULT_OFFSET,
  };

  // Every filter is compared against undefined rather than tested for truth: `completed: false`
  // and `priority: 0` are filters a caller meant, and truthiness would throw both away.
  if (args.projectId !== undefined) query["projectId"] = args.projectId;
  if (args.boardId !== undefined) query["boardId"] = args.boardId;
  if (args.boardColumnId !== undefined) query["boardColumnId"] = args.boardColumnId;
  if (args.assignee !== undefined) query["userId"] = args.assignee;
  if (args.completed !== undefined) query["completed"] = args.completed;
  if (args.includeAll !== undefined) query["all"] = args.includeAll;
  if (args.priority !== undefined) query["priority"] = args.priority;
  if (args.type !== undefined) query["type"] = args.type;
  // buildQuery drops an empty array on its own, so this changes no URL. It is here to say at the
  // point the filter is decided that no tags means no filter, rather than leaving the reader to go
  // and check what the serializer does with one.
  if (args.tags !== undefined && args.tags.length > 0) query["tags"] = args.tags;
  if (args.search !== undefined) query["search"] = args.search;
  if (args.startDate !== undefined) query["startDate"] = toApiDate(args.startDate);
  if (args.endDate !== undefined) query["endDate"] = toApiDate(args.endDate);
  if (args.completedFrom !== undefined) query["completedAtFrom"] = toApiDate(args.completedFrom);
  if (args.completedTo !== undefined) query["completedAtTo"] = toApiDate(args.completedTo);
  // Descending is a minus on the field, so with nothing to sort by there is nothing to negate.
  if (args.sortBy !== undefined) {
    query["sortBy"] = args.desc === true ? `-${args.sortBy}` : args.sortBy;
  }

  return query;
}

export function registerSearchTasksTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_search_tasks",
    {
      title: "Find tasks",
      description:
        "Searches tasks with filters and returns compact rows. Descriptions are omitted on " +
        "purpose — use weeek_get_task for the full card and its discussion. Ids for projects, " +
        "boards and columns come from weeek_context.",
      inputSchema: z.strictObject(SEARCH_SHAPE),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) =>
      guard(async () => {
        // Loaded before the search rather than after it: the rows need it to name assignees
        // either way, so resolving "me" out of it costs no request of its own.
        const directory = await context.directory.load();
        const assignee = args.assignee === "me" ? directory.me.id : args.assignee;
        const perPage = args.perPage ?? DEFAULT_PER_PAGE;
        const offset = args.offset ?? DEFAULT_OFFSET;

        const payload = await context.client.request(OPS.searchTasks, {
          query: buildSearchQuery({ ...args, assignee, perPage, offset }),
        });
        const tasks = unwrapEnvelope<RawTask[]>(payload, "tasks");
        const nameOf = memberNameIn(directory);

        // Read like every other Weeek flag: it arrives as a real boolean today, but the query
        // side of this API takes booleans only as 1/0, and a strict === true would silently drop
        // the paging hint from a page that has more behind it if that habit ever crossed over.
        const hasMore = isTrue((payload as { hasMore?: unknown }).hasMore);

        return jsonResult({
          tasks: tasks.map((task) => toTaskRow(task, nameOf)),
          hasMore,
          // Weeek pages by offset and returns no cursor, so the next one is spelled out. Without
          // it a model that sees hasMore tends to repeat the same call and get the same page.
          ...(hasMore
            ? { nextPage: `more tasks match — repeat with offset: ${offset + perPage}` }
            : {}),
        });
      }),
  );
}
