import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAttachmentTools } from "./attachments.ts";
import { registerCommentWriteTools, registerListCommentsTool } from "./comments.ts";
import { registerContextTool } from "./context.ts";
import { registerGetTaskTool } from "./get-task.ts";
import { registerSearchTasksTool } from "./search-tasks.ts";
import type { ToolContext } from "./shared.ts";
import { registerTaskMutationTools } from "./task-mutations.ts";

/**
 * The whole tool set in one readable list — the four that only read first, then the nine that
 * change something. weeek_get_attachment sits with the second group: it reads from Weeek, but it
 * writes a file to this machine, and its annotations say so.
 *
 * Nothing in `src/` reads this back, registerAllTools included: every tool names itself in its own
 * registerTool call. That independence is the point. `index.test.ts` stands a real server up and
 * compares what a client is served against this list, so the two can only agree by being right,
 * and a tool added, renamed or dropped without this list following it fails the suite.
 */
export const TOOL_NAMES = [
  "weeek_context",
  "weeek_search_tasks",
  "weeek_get_task",
  "weeek_list_comments",
  "weeek_create_task",
  "weeek_update_task",
  "weeek_move_task",
  "weeek_complete_task",
  "weeek_set_task_people",
  "weeek_add_comment",
  "weeek_get_attachment",
  "weeek_upload_attachment",
  "weeek_delete_comment",
] as const;

/**
 * Puts every tool on the server.
 *
 * Registration itself talks to nothing: each register function only describes its tool and closes
 * over the context, which is first read when a call arrives. So this is safe to run before the
 * workspace is reachable — and cheap, because the directory is fetched by the first tool that
 * needs it rather than at startup.
 */
export function registerAllTools(server: McpServer, context: ToolContext): void {
  registerContextTool(server, context);
  registerSearchTasksTool(server, context);
  registerGetTaskTool(server, context);
  registerListCommentsTool(server, context);
  registerCommentWriteTools(server, context);
  registerTaskMutationTools(server, context);
  registerAttachmentTools(server, context);
}
