import { htmlToMarkdown } from "./markup.ts";

// A task answers with far more than this — projectId, boardId, locations, subscribers, timer,
// workloads and repeat among them, none of which the generated Task schema declares. Only the two
// fields every caller relies on are named; everything else is read out defensively below.
export type RawTask = Record<string, unknown> & { id: number; title: string };

export type TaskRow = {
  id: number;
  title: string;
  priority: string | null;
  isCompleted: boolean;
  isDeleted: boolean;
  projectId: number | null;
  boardId: number | null;
  boardColumnId: number | null;
  assignees: string[];
  updatedAt: string | null;
};

const PRIORITIES = ["low", "medium", "high", "hold"] as const;

/**
 * Names the priority Weeek stores as 0-3.
 *
 * A task nobody prioritised carries `null`, and Weeek itself rejects a filter outside 0-3 with
 * 422 "The selected priority is invalid." — so anything else means the shape changed underneath
 * us, and it stays unlabelled rather than being given a word that would read as fact.
 */
export function priorityLabel(value: unknown): string | null {
  return typeof value === "number" ? (PRIORITIES[value] ?? null) : null;
}

/** Weeek stores a description as HTML; a model reads markdown. */
export function taskDescriptionMarkdown(task: RawTask): string {
  const description = task["description"];
  return typeof description === "string" ? htmlToMarkdown(description) : "";
}

/**
 * Projects a task down to the row a list answers with.
 *
 * The description is left out on purpose. A search returns up to 100 tasks, and their full texts
 * would cost more context than this server's entire tool set — the full card is read one task at
 * a time through `weeek_get_task`. Every field is built here rather than spread from the task, so
 * the row is exactly what its type promises and no wire field rides along unnoticed.
 *
 * Names are resolved by the caller's callback, which is what keeps a workspace, and the requests
 * that load one, out of a pure formatter. It answers for one id at a time, like the one
 * `renderCommentTree` takes: a callback handed the whole array could answer with fewer names than
 * it was given, and a task assigned to someone we cannot name would then read as unassigned — a
 * wrong answer rather than an incomplete one. Per id, that cannot be expressed.
 */
export function toTaskRow(task: RawTask, names: (id: string) => string): TaskRow {
  // The elements are checked as well as the array: a cast would hand a non-string id to `names`
  // and then store it in a field whose type promises a string.
  const ids = task["assignees"];
  const assignees = Array.isArray(ids)
    ? ids.filter((id: unknown): id is string => typeof id === "string")
    : [];

  return {
    id: task.id,
    title: task.title,
    priority: priorityLabel(task["priority"]),
    isCompleted: isTrue(task["isCompleted"]),
    // A search with `all` asks for deleted tasks as well as completed ones, and 16 of the first
    // 100 the live workspace answers with are deleted — one of them not completed either, so
    // without this flag it would read as work still in progress.
    isDeleted: isTrue(task["isDeleted"]),
    // The primary location, not the only one: a task can be filed in several places at once
    // (POST /tm/tasks/{task_id}/locations), and the full `locations` array is part of the card
    // weeek_get_task returns. These two are here because the column id alone cannot be looked up —
    // resolving a column needs the board it belongs to, and the workspace has 110 of them.
    projectId: numberOrNull(task["projectId"]),
    // Null for a task filed in a project but on no board, which is a normal state, not an error.
    boardId: numberOrNull(task["boardId"]),
    boardColumnId: numberOrNull(task["boardColumnId"]),
    assignees: assignees.map((id) => names(id)),
    updatedAt: typeof task["updatedAt"] === "string" ? task["updatedAt"] : null,
  };
}

/**
 * Reads a flag in both the forms Weeek could send it in.
 *
 * Its answers carry real booleans — verified on the wire for isCompleted and isDeleted — but its
 * query side accepts booleans only as 1/0, which is what `buildQuery` in quirks.ts exists for. If
 * that habit ever reaches the responses, a strict `=== true` would answer "not completed" for a
 * completed task: a wrong answer, silently. Both forms count, and nothing else does — an unknown
 * shape reads as false rather than as a claim that the task is done.
 */
export function isTrue(value: unknown): boolean {
  return value === true || value === 1;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
