import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { markdownToHtml } from "../format/markup.ts";
import type { RawTask } from "../format/tasks.ts";
import type { WeeekOperation } from "../openapi-types.ts";
import { OPS } from "../weeek/operations.ts";
import { renderCard } from "./card.ts";
import { TASK_TYPES } from "./search-tasks.ts";
import {
  WRITE_ANNOTATIONS,
  type ToolContext,
  asRecord,
  errorResult,
  guard,
  jsonResult,
  nullAsAbsent,
  weeekId,
} from "./shared.ts";

export type CreateArgs = {
  title: string;
  projectId: number;
  description?: string;
  boardColumnId?: number;
  parentId?: number;
  priority?: number;
  type?: string;
};

/**
 * Turns the arguments of weeek_create_task into the body Weeek takes.
 *
 * A task belongs to its project through `locations`, an array of `{projectId, boardColumnId}`, and
 * one entry is what this server ever sends. The column is null rather than absent when none was
 * given: both fields are required inside the entry, and that shape is the one confirmed working.
 */
export function buildCreateTaskBody(args: CreateArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: args.title,
    locations: [{ projectId: args.projectId, boardColumnId: args.boardColumnId ?? null }],
  };

  // Weeek stores a description as HTML and its normaliser drops bare newlines and deletes
  // <pre> blocks whole, so what is sent is the HTML that survives that rather than the text.
  if (args.description !== undefined) body["description"] = markdownToHtml(args.description);
  // Compared against undefined rather than tested for truth, for priority above all: 0 is the
  // lowest priority and a caller who asks for it means it.
  if (args.parentId !== undefined) body["parentId"] = args.parentId;
  if (args.priority !== undefined) body["priority"] = args.priority;
  if (args.type !== undefined) body["type"] = args.type;

  return body;
}

/**
 * Everything weeek_update_task takes, declared once and used as both the schema and the whitelist.
 *
 * The body is built by reading these keys off the arguments rather than by spreading whatever
 * arrived, and that is what keeps `description` off the wire for good: Weeek accepts a description
 * on this endpoint, answers `{"success": true}`, and stores nothing. `taskId` is the one key here
 * that is not a body field — it names the task in the path — and buildUpdateBody skips it by that
 * name. Everything else added to this object reaches the wire on its own, which is the whole point
 * of there being one object: a field declared beside it instead would be advertised to the model
 * and then silently dropped.
 *
 * Five fields take null as well as a value, and null is what clears them — a PUT of
 * `{"dueDate": null, "priority": null}` answers 200 with both emptied. Without it a due date could
 * be set and never removed: null is the one thing a model would try, and zod would be what refused
 * it. buildUpdateBody tests against undefined rather than truth, so a null travels. Each of the
 * five says so in words as well, because a zod constraint does not reach the model in Codex and an
 * undiscoverable capability is the state .nullable() was added to end.
 *
 * `title` is the exception, and deliberately: the spec marks it nullable and Weeek may well accept
 * one, but a task with no title is unreadable everywhere it appears and no caller has a reason to
 * ask for that. The schema is where what should not be attempted is prevented — the same rule that
 * keeps `description` off this tool and `tags` off create.
 *
 * The dates go out exactly as written, and the format here is Y-m-d: `"2026-09-15"` is accepted and
 * `"15.09.2026"` comes back as 422 "The due date does not match the format Y-m-d." That is the
 * opposite of what this same API wants from a search filter, where `toApiDate` converts to
 * dd.mm.yyyy. One API, two date formats, so nothing on this path converts anything.
 */
const UPDATE_PATH_PARAM = "taskId";

export const UPDATE_SHAPE = {
  taskId: weeekId().describe("The task id."),
  title: z.string().min(1).optional().describe("The task title."),
  priority: z
    .number()
    .int()
    .min(0)
    .max(3)
    .nullable()
    .optional()
    .describe("0 low, 1 medium, 2 high, 3 hold. Send null to clear it."),
  type: z
    .enum(TASK_TYPES)
    .nullable()
    .optional()
    .describe("action, meet or call. Send null to clear it."),
  startDate: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("YYYY-MM-DD. Send null to clear it."),
  dueDate: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("YYYY-MM-DD. Send null to clear it."),
  duration: z
    .number()
    .int()
    .min(0)
    // Bounded for the reason ids are: an unbounded .int() renders the whole safe-integer range
    // into the JSON Schema every client is handed, and no task is estimated in billions of minutes.
    .max(2147483647)
    .nullable()
    .optional()
    .describe("Estimated minutes. Send null to clear it."),
  tags: z
    .array(weeekId())
    .optional()
    .describe(
      "The task's complete tag list — it replaces whatever is there. To add one, read the " +
        "task's tags with weeek_get_task first and send them all.",
    ),
};

/**
 * The four calls that add and remove people, as a table.
 *
 * The task id is spelled `taskId` on the assignee endpoints and `task_id` on the watcher ones —
 * Weeek's own inconsistency, and a path parameter left unfilled is caught by the client before the
 * request leaves rather than coming back as an error that names nothing.
 */
const PEOPLE_STEPS = [
  { name: "addAssignees", operation: OPS.addAssignees, idParam: "taskId", field: "assignees" },
  {
    name: "removeAssignees",
    operation: OPS.removeAssignees,
    idParam: "taskId",
    field: "assignees",
  },
  { name: "addWatchers", operation: OPS.addWatchers, idParam: "task_id", field: "watchers" },
  { name: "removeWatchers", operation: OPS.removeWatchers, idParam: "task_id", field: "watchers" },
] as const satisfies readonly {
  name: string;
  operation: WeeekOperation;
  idParam: string;
  field: string;
}[];

/** One request of a tool that spends several, named so a failure can say which one it was. */
type Step = { name: string; send: () => Promise<unknown> };

/**
 * The task a mutation answered with, when it answered with one.
 *
 * Both endpoints do return one — the live answer is `{"success": true, "task": {…}}` — so this
 * is not a workaround for a missing field. It is here for what unwrapEnvelope would do if the
 * shape ever changed: it turns an unexpected body into an error, and on a write that means the
 * model is told the call failed at the moment it landed. Its recovery is to send the write again,
 * and for create that leaves a duplicate task in a real tracker — the very thing the client's
 * refusal to replay a POST exists to prevent, reintroduced one layer above it. A rejected call is
 * already an error by the time a body reaches here, `success: false` included, so the asymmetry is
 * plain: losing a convenience field costs incomparably less than reporting a write that landed as
 * one that did not.
 */
function answeredTask(payload: unknown): RawTask | null {
  const task = asRecord(asRecord(payload)?.["task"]);
  return task === undefined ? null : (task as RawTask);
}

/**
 * Says that completing this task made Weeek create another one.
 *
 * Weeek generates the next occurrence of a recurring task on its own and returns it in
 * `repeatedTask`. Unreported, that task simply appears in the tracker with nothing in the
 * conversation to account for it. The id is read out of either shape the field could take, because
 * the only capture of it is null.
 */
function repeatedOccurrenceNote(payload: unknown): string | null {
  const repeated = asRecord(payload)?.["repeatedTask"];
  // null is the only value ever captured, but false, 0 and "" all say the same nothing — and each
  // of them, read as a task, would be announced as one that now exists.
  if (!repeated) return null;

  const id = typeof repeated === "number" ? repeated : asRecord(repeated)?.["id"];
  return typeof id === "number"
    ? `This task repeats: Weeek created the next occurrence as task ${id}.`
    : "This task repeats: Weeek created the next occurrence, returned here as repeatedTask.";
}

/**
 * Runs the steps of a multi-request tool in order and stops at the first failure.
 *
 * Stopping is the point. A bad task id fails all four calls of weeek_set_task_people for one
 * cause, and four errors describe that cause no better than one does. What the caller cannot work
 * out for itself is how much of the change survived, so the failure carries that with it: Weeek's
 * answer describes the one call that failed and can say nothing about the ones around it.
 */
async function applyInOrder(
  steps: readonly Step[],
): Promise<{ applied: string[]; failure: CallToolResult | null }> {
  const applied: string[] = [];

  for (const [index, step] of steps.entries()) {
    try {
      await step.send();
    } catch (error) {
      const pending = steps.slice(index + 1).map((rest) => rest.name);
      return { applied, failure: errorResult(error, trailAfter(applied, pending)) };
    }
    applied.push(step.name);
  }

  return { applied, failure: null };
}

function trailAfter(applied: readonly string[], pending: readonly string[]): string {
  return [
    // Said even when it is empty: that the task is untouched is exactly what tells a caller the
    // whole call can be sent again once the cause is fixed.
    applied.length === 0
      ? "Nothing was applied before it failed."
      : `Applied before it failed: ${applied.join(", ")}.`,
    ...(pending.length === 0 ? [] : [`Not attempted: ${pending.join(", ")}.`]),
    "Check the task before sending this again.",
  ].join(" ");
}

function buildUpdateBody(args: object): Record<string, unknown> {
  const given = args as Record<string, unknown>;
  const body: Record<string, unknown> = {};

  for (const field of Object.keys(UPDATE_SHAPE)) {
    if (field === UPDATE_PATH_PARAM) continue;
    const value = given[field];
    // Against undefined rather than truth, so that null — which is how Weeek clears a field —
    // travels, along with a priority of 0.
    if (value !== undefined) body[field] = value;
  }

  return body;
}

function peopleSteps(
  context: ToolContext,
  taskId: number,
  lists: Record<string, readonly string[] | undefined>,
): Step[] {
  return PEOPLE_STEPS.filter((step) => (lists[step.name]?.length ?? 0) > 0).map((step) => ({
    name: step.name,
    send: () =>
      context.client.request(step.operation, {
        pathParams: { [step.idParam]: taskId },
        body: { [step.field]: lists[step.name] },
      }),
  }));
}

export function registerTaskMutationTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_create_task",
    {
      title: "Create a task",
      description:
        "Creates a task. Give the description in markdown — it is converted to the HTML Weeek " +
        "stores. The description can only be set here and can never be changed later, so " +
        "include it now if you have one. Tags are the opposite: Weeek ignores them on creation, " +
        "so set them with weeek_update_task straight after — it takes the whole list. " +
        "Assignees are set afterwards too, with weeek_set_task_people.",
      inputSchema: z.strictObject({
        title: z.string().min(1).describe("The task title."),
        projectId: weeekId().describe(
          "Which project the task belongs to. Ids come from weeek_context.",
        ),
        description: nullAsAbsent(z.string()).describe(
          "Markdown. Can never be changed after creation.",
        ),
        boardColumnId: nullAsAbsent(weeekId()).describe(
          "Which column to place it in. Omit to leave it unplaced.",
        ),
        parentId: nullAsAbsent(weeekId()).describe("Make this a subtask of that task."),
        // Codex drops every zod constraint on its way to the model, so the range that matters is
        // spelled out in words as well. Enums survive and are not repeated.
        priority: nullAsAbsent(z.number().int().min(0).max(3)).describe(
          "0 low, 1 medium, 2 high, 3 hold.",
        ),
        type: nullAsAbsent(z.enum(TASK_TYPES)).describe("action, meet or call."),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      guard(async () => {
        const payload = await context.client.request(OPS.createTask, {
          body: buildCreateTaskBody(args),
        });

        const task = answeredTask(payload);
        // `created` is on both answers, not only the degraded one. The rule the comment tool
        // already follows: a flag a model learns from one call and finds undefined on the next
        // reads as a failure exactly when everything went right.
        return jsonResult(
          task === null
            ? {
                created: true,
                note:
                  "Weeek accepted the task but answered without the card, so its id is not " +
                  "here. Find it with weeek_search_tasks.",
              }
            : { ...(await renderCard(task, context.directory)), created: true },
        );
      }),
  );

  server.registerTool(
    "weeek_update_task",
    {
      title: "Update a task",
      description:
        "Changes a task's fields. The description is not among them — Weeek accepts it only at " +
        "creation and ignores it here while still answering success. Use weeek_move_task to " +
        "change board or column.",
      inputSchema: z.strictObject(UPDATE_SHAPE),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      guard(async () => {
        const body = buildUpdateBody(args);
        // A PUT with nothing in it answers success and changes nothing, which reads to a model as
        // a change that landed. The fields are named so the call can be fixed rather than retried.
        if (Object.keys(body).length === 0) {
          throw new Error(
            "Give at least one field to change: " +
              `${Object.keys(UPDATE_SHAPE)
                .filter((field) => field !== UPDATE_PATH_PARAM)
                .join(", ")}.`,
          );
        }

        const payload = await context.client.request(OPS.updateTask, {
          pathParams: { id: args.taskId },
          body,
        });

        const task = answeredTask(payload);
        // taskId on both, for the same reason as the flag: the card calls the task `id` and the
        // degraded answer called it `taskId`, so a model reading an id out of this tool had to
        // know both spellings while ever seeing only one of them.
        return jsonResult(
          task === null
            ? { taskId: args.taskId, updated: true, fields: Object.keys(body) }
            : {
                ...(await renderCard(task, context.directory)),
                taskId: args.taskId,
                updated: true,
              },
        );
      }),
  );

  server.registerTool(
    "weeek_move_task",
    {
      title: "Move a task",
      description:
        "Moves a task to another board, another column, or both. When both are given the board " +
        "is changed first, because a column id belongs to a board and the old one stops being " +
        "valid once the board changes.",
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        boardId: nullAsAbsent(weeekId()).describe(
          "The board to move it to. Ids come from weeek_context.",
        ),
        boardColumnId: nullAsAbsent(weeekId()).describe(
          "The column to move it to, within its board.",
        ),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ taskId, boardId, boardColumnId }) =>
      guard(async () => {
        const steps: Step[] = [];

        // Pushed first, and this order is the whole reason the two calls are not sent together:
        // a column belongs to a board, so a column set before the move is set on the old board.
        if (boardId !== undefined) {
          steps.push({
            name: "board",
            send: () =>
              context.client.request(OPS.changeBoard, {
                pathParams: { id: taskId },
                body: { boardId },
              }),
          });
        }

        if (boardColumnId !== undefined) {
          steps.push({
            name: "column",
            send: () =>
              context.client.request(OPS.changeBoardColumn, {
                pathParams: { id: taskId },
                body: { boardColumnId },
              }),
          });
        }

        if (steps.length === 0) {
          throw new Error(
            "Give boardId, boardColumnId or both — there is nowhere to move it to.",
          );
        }

        const { failure } = await applyInOrder(steps);
        // The destination is named rather than the steps: an argument that was not given is
        // undefined and drops out of the JSON, so what is left is exactly what changed.
        return failure ?? jsonResult({ taskId, boardId, boardColumnId, moved: true });
      }),
  );

  server.registerTool(
    "weeek_complete_task",
    {
      title: "Complete or reopen a task",
      description:
        "Marks a task done, or reopens it. Completing a recurring task makes Weeek create the " +
        "next occurrence — when that happens the answer says so.",
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        completed: z.boolean().describe("True to complete, false to reopen."),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ taskId, completed }) =>
      guard(async () => {
        const payload = await context.client.request(
          completed ? OPS.completeTask : OPS.unCompleteTask,
          // Nothing to send: the task is named in the path and the direction is the endpoint.
          { pathParams: { id: taskId }, body: {} },
        );

        // Only completing creates the next occurrence; announcing one on the way back would be
        // an invention.
        const note = completed ? repeatedOccurrenceNote(payload) : null;
        // `success` is dropped because it says nothing here — a call that failed never reaches
        // this line. The rest passes through, but underneath the tool's own keys, which are
        // written after it so that no payload can rename the task this call was about.
        const passedThrough = Object.entries(asRecord(payload) ?? {}).filter(
          ([key]) => key !== "success",
        );

        // `changed`, not `completed`: `completed` is this call's own argument echoed back, and
        // the slot a boolean sits in here now means "it worked" on every other write. Reopening a
        // task succeeds and echoes `completed: false`, which under that reading is a report of
        // failure. The outcome needs a name the argument cannot collide with.
        return jsonResult({
          ...Object.fromEntries(passedThrough),
          taskId,
          completed,
          changed: true,
          ...(note === null ? {} : { note }),
        });
      }),
  );

  server.registerTool(
    "weeek_set_task_people",
    {
      title: "Assign people to a task",
      description:
        "Adds or removes assignees and watchers. Member ids come from weeek_context, or from a " +
        "task's assignees field — do not pair a name to an id by position, the two lists are not " +
        "aligned.",
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        addAssignees: nullAsAbsent(z.array(z.string())).describe("Member uuids to add."),
        removeAssignees: nullAsAbsent(z.array(z.string())).describe("Member uuids to remove."),
        addWatchers: nullAsAbsent(z.array(z.string())).describe("Member uuids to add."),
        removeWatchers: nullAsAbsent(z.array(z.string())).describe("Member uuids to remove."),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ taskId, ...lists }) =>
      guard(async () => {
        const steps = peopleSteps(context, taskId, lists);
        // Four empty lists are four requests Weeek would accept and a success for a call that
        // changed nobody, which is the one answer a model cannot tell from a real one.
        if (steps.length === 0) {
          throw new Error(
            `Give at least one of ${PEOPLE_STEPS.map((step) => step.name).join(", ")} — ` +
              "there is nobody to add or remove.",
          );
        }

        const { applied, failure } = await applyInOrder(steps);
        // `changed` rather than `assigned`, because this tool also removes people and also runs
        // on watchers alone: `assigned: true` after {removeAssignees: [...]} claims something the
        // call did not do. The precise verbs — created, updated, moved, added, deleted — stay
        // where they are true. `applied` says which calls went out, which is a different
        // question and the one that matters when only some of them did.
        return failure ?? jsonResult({ taskId, applied, changed: true });
      }),
  );
}
