import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  READ_ONLY_ANNOTATIONS,
  type ToolContext,
  guard,
  jsonResult,
  nullAsAbsent,
  weeekId,
} from "./shared.ts";

export function registerContextTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_context",
    {
      title: "Workspace directory",
      description:
        "Returns who you are, the workspace, and its projects, members and tags. Pass projectId " +
        "to also get that project's boards, and boardId to also get that board's columns. Boards " +
        "and columns are never returned wholesale: a workspace has hundreds of boards, and " +
        "fetching all of them would cost over a hundred requests.",
      inputSchema: z.strictObject({
        projectId: nullAsAbsent(weeekId()).describe("Add this project's boards to the result."),
        boardId: nullAsAbsent(weeekId()).describe("Add this board's columns to the result."),
        refresh: nullAsAbsent(z.boolean()).describe(
          "Refetch instead of using the cached snapshot, which lasts five minutes.",
        ),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ projectId, boardId, refresh }) =>
      guard(async () => {
        const directory = await context.directory.load(refresh === true);

        return jsonResult({
          ...directory,
          ...(projectId !== undefined ? { boards: await context.directory.boards(projectId) } : {}),
          ...(boardId !== undefined ? { columns: await context.directory.columns(boardId) } : {}),
        });
      }),
  );
}
