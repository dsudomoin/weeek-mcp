import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OPS } from "../weeek/operations.ts";
import { commentsHint, loadComments } from "./get-task.ts";
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  type ToolContext,
  asRecord,
  guard,
  jsonResult,
  nullAsAbsent,
  weeekId,
} from "./shared.ts";

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

export function registerListCommentsTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_list_comments",
    {
      title: "Read a task's comments",
      description:
        "Reads a task's discussion on its own, without the task card. Comments are shown oldest " +
        "first with author names resolved, replies nested under what they answer. Use this to " +
        "page back through a long thread, or to re-read it after posting.",
      // Codex drops every zod constraint on its way to the model, so the bounds that matter are
      // spelled out in words as well. The duplication is deliberate.
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        limit: nullAsAbsent(z.number().int().min(1).max(100)).describe(
          "How many comments to return, 1 to 100, 50 by default.",
        ),
        offset: nullAsAbsent(
          z
            .number()
            .int()
            .min(0)
            // Bounded for the same reason ids are: without a maximum, zod renders the safe-integer
            // one into the schema, and 9007199254740991 comments is not a real number.
            .max(2147483647),
        ).describe(
          "How many comments to skip, 0 by default. Comments page newest-first, so a larger " +
            "offset reads further back.",
        ),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ taskId, limit, offset }) =>
      guard(async () => {
        const take = limit ?? DEFAULT_LIMIT;
        const skip = offset ?? DEFAULT_OFFSET;
        const comments = await loadComments(context, taskId, take, skip);
        // The same sentence a card carries, worked out from the page this call actually fetched.
        // A model that sees only hasMore tends to repeat the call it just made and get the page
        // it already has, so what to call next is spelled out rather than implied.
        const nextPage = commentsHint(comments.hasMore, taskId, take, skip);

        return jsonResult({
          comments: comments.rendered,
          hasMore: comments.hasMore,
          ...(nextPage === null ? {} : { nextPage }),
        });
      }),
  );
}

/**
 * The comment Weeek answered the write with, when it answered with one.
 *
 * It does answer with one — the live body is `{"comment": {id, parentId, authorId, markdown,
 * createdAt, updatedAt}}`, and with no `success` beside it, comments being the endpoints that
 * answer without the envelope. So this is not a workaround for a field that is missing, and
 * `unwrapEnvelope(payload, "comment")` would work today.
 *
 * It is here for what that would do if the shape ever changed, which is the reasoning written out
 * at `answeredTask` in task-mutations.ts, weighing more here than it does there.
 * `unwrapEnvelope` turns a body without the expected key into an error,
 * and on a write that error tells the model a comment it did in fact post was not posted. The
 * model's recovery is to post it again, and the thread is left holding the same text twice — the
 * duplicate the client's refusal to replay a POST exists to prevent, reintroduced one layer above
 * it, and this is the one object in Weeek that cannot afterwards be edited into shape. A call
 * Weeek rejected is already an error long before it reaches this line, `success: false` included,
 * so nothing is being swallowed: what is given up is the convenience of learning the new id in the
 * same round trip, and weeek_list_comments answers that question in one more.
 */
function answeredComment(payload: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(payload)?.["comment"]) ?? null;
}

export function registerCommentWriteTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_add_comment",
    {
      title: "Write a comment",
      description:
        "Adds a comment to a task. The text is markdown and Weeek keeps it as written — " +
        "newlines, lists, links and code all survive. A comment cannot be edited afterwards: " +
        "the API offers only create and delete, and no file can be attached to one.",
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        markdown: z.string().min(1).describe("The comment text, in markdown."),
        parentId: nullAsAbsent(weeekId()).describe(
          "Reply to this comment instead of starting a new thread. Comment ids come from " +
            "weeek_get_task.",
        ),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ taskId, markdown, parentId }) =>
      guard(async () => {
        // The markdown goes out untouched. A task description is HTML and is converted on its way
        // in; a comment is markdown at both ends, and running it through the same converter would
        // post the HTML source as the text of the comment.
        const payload = await context.client.request(OPS.createComment, {
          pathParams: { taskId },
          // Omitted rather than sent as null: null is what the spec allows for "no parent", but
          // the field absent means the same thing and is the shape every other call here uses.
          body: parentId === undefined ? { markdown } : { markdown, parentId },
        });

        const created = answeredComment(payload);
        // Projected, not echoed. The body Weeek sends back carries the markdown the model wrote a
        // moment ago, plus authorId, updatedAt and its own copy of the text — spending a long
        // comment twice to tell the model what it already knows. What is left is what a reply or a
        // delete actually needs. `added` is on both answers so that a flag learned from one call is
        // not undefined on the next.
        return jsonResult(
          created === null
            ? {
                taskId,
                added: true,
                note:
                  "Weeek accepted the comment but answered without it, so its id is not here. " +
                  "Read the thread with weeek_list_comments.",
              }
            : {
                id: created["id"],
                parentId: created["parentId"],
                taskId,
                createdAt: created["createdAt"],
                added: true,
              },
        );
      }),
  );

  server.registerTool(
    "weeek_delete_comment",
    {
      title: "Delete a comment",
      description:
        "Deletes a comment permanently. There is no undo and no edit. Replies to it are not " +
        "deleted — they move up to the top level of the thread.",
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        commentId: weeekId().describe("The comment to delete. Ids come from weeek_get_task."),
      }),
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ taskId, commentId }) =>
      guard(async () => {
        // Answered 204 with an empty body, which the client returns as null. There is nothing to
        // unwrap, and unwrapping it would report a deletion that succeeded as one that failed.
        await context.client.request(OPS.deleteComment, { pathParams: { taskId, commentId } });
        return jsonResult({ taskId, commentId, deleted: true });
      }),
  );
}
