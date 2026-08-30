import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type RawComment, buildCommentTree, renderCommentTree } from "../format/comments.ts";
import { type RawTask, isTrue } from "../format/tasks.ts";
import { unwrapEnvelope } from "../http/quirks.ts";
import { memberNameIn } from "../weeek/directory.ts";
import { OPS } from "../weeek/operations.ts";
import { renderCard } from "./card.ts";
import {
  READ_ONLY_ANNOTATIONS,
  type ToolContext,
  guard,
  jsonResult,
  nullAsAbsent,
  weeekId,
} from "./shared.ts";

const DEFAULT_COMMENTS_LIMIT = 20;

/**
 * Says that the page ends before the discussion does, and what to call to see the rest.
 *
 * This is the only thing between a model and a silently truncated thread: the answer looks whole
 * either way, and the oldest comment on the page reads as the first thing anyone said. The next
 * offset is spelled out because Weeek pages by offset and returns no cursor.
 *
 * Both tools say it, from the page each of them actually fetched — hence the offset argument
 * rather than an assumption that the page began at zero, which holds for a card and not for
 * weeek_list_comments. The arguments are ordered as `loadComments` takes them, since the two are
 * always called with the same four values a line apart. Unlike weeek_search_tasks it names the
 * tool instead of saying "repeat": it is also emitted from inside a task card, where repeating
 * the call that produced it would fetch the same first page of comments again.
 *
 * It answers the orphan mark as well, in the mark's own words. `renderCommentTree` marks a reply
 * whose parent did not come with this page but cannot say where that parent went; a parent is
 * always older than its reply and the pages run newest first, so the parent is always further
 * back, and a page holding such a reply always has more behind it. One sentence, present exactly
 * when either question can be asked — and on the last page an orphan cannot arise at all, since
 * its parent would have to sit on a page after the last one.
 */
export function commentsHint(
  hasMore: boolean,
  taskId: number,
  limit: number,
  offset: number,
): string | null {
  return hasMore
    ? `older comments remain — call weeek_list_comments(taskId: ${taskId}, ` +
        `offset: ${offset + limit}), which also reaches any parent marked as not on this page`
    : null;
}

/** Reads one page of a discussion and renders it with its authors named. */
export async function loadComments(
  context: ToolContext,
  taskId: number,
  limit: number,
  offset: number,
): Promise<{ rendered: string; hasMore: boolean }> {
  // Both are needed before anything can be rendered and neither depends on the other, so a cold
  // directory does not turn into a second round trip after the comments have already arrived.
  const [payload, directory] = await Promise.all([
    context.client.request(OPS.listComments, { pathParams: { taskId }, query: { limit, offset } }),
    context.directory.load(),
  ]);

  const tree = buildCommentTree(unwrapEnvelope<RawComment[]>(payload, "comments"));

  return {
    rendered: renderCommentTree(tree, memberNameIn(directory)),
    // Read like every other Weeek flag rather than with === true: this API takes booleans only as
    // 1/0 on its query side, and were that ever to cross over to a response, a strict comparison
    // would drop the hint from a truncated thread and hide half a discussion without a word.
    hasMore: isTrue((payload as { hasMore?: unknown }).hasMore),
  };
}

export function registerGetTaskTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_get_task",
    {
      title: "Read a task",
      description:
        "Returns a task with its description and its discussion. The description is converted to " +
        "markdown — Weeek stores it as HTML. Comments are shown oldest first with author names " +
        "resolved, replies nested under what they answer.",
      // Codex drops every zod constraint on its way to the model, so the bounds that matter are
      // spelled out in words as well. The duplication is deliberate.
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        includeComments: nullAsAbsent(z.boolean()).describe(
          "Fetch the discussion as well. On by default.",
        ),
        commentsLimit: nullAsAbsent(z.number().int().min(1).max(100)).describe(
          "How many of the most recent comments to include, 1 to 100, 20 by default.",
        ),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ taskId, includeComments, commentsLimit }) =>
      guard(async () => {
        // One value for the request and for the hint below: an offset the call did not actually
        // use would send the model past comments it has never seen, and call that the rest.
        const limit = commentsLimit ?? DEFAULT_COMMENTS_LIMIT;
        const withComments = includeComments !== false;

        // Two independent endpoints, so they go out together. They also fail together: a card that
        // quietly arrived without its discussion would be exactly the silent loss the hint exists
        // to prevent, and a missing task fails both anyway.
        const [taskPayload, comments] = await Promise.all([
          context.client.request(OPS.getTask, { pathParams: { id: taskId } }),
          withComments ? loadComments(context, taskId, limit, 0) : null,
          // Started here and its result unused on purpose: renderCard looks the directory up for
          // itself, and this warms the cache alongside the task fetch so that lookup does not turn
          // into a round trip of its own. loadComments is already asking for it when it runs.
          context.directory.load(),
        ]);

        const task = unwrapEnvelope<RawTask>(taskPayload, "task");
        return jsonResult({
          ...(await renderCard(task, context.directory)),
          ...(comments === null
            ? {}
            : {
                comments: comments.rendered,
                // The card always reads from the top of the thread, so its next page starts one
                // page in; weeek_list_comments passes the offset it was actually given.
                commentsHint: commentsHint(comments.hasMore, taskId, limit, 0),
              }),
        });
      }),
  );
}
