import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Call,
  type Handler,
  captureTool as capture,
  payloadOf,
  toolContext,
} from "../testing/tools.ts";
import { registerContextTool } from "./context.ts";

// The two endpoints only this tool reaches; the workspace behind them is the shared one.
const LAZY: Record<string, unknown> = {
  "/tm/boards": { success: true, boards: [{ id: 143, name: "Sprint" }] },
  "/tm/board-columns": { success: true, boardColumns: [{ id: 832, name: "In progress" }] },
};

function captureTool(calls: Call[]): Handler {
  return capture(registerContextTool, toolContext(LAZY, calls)).handler;
}

test("without a project or a board, no board is fetched at all", async () => {
  // The whole reason this tool takes ids: the workspace has 110 boards, and walking them would
  // cost a request each. Answering with boards nobody asked for is the failure to guard against.
  const calls: Call[] = [];
  const payload = payloadOf(await captureTool(calls)({}));

  assert.deepEqual(
    calls.map((call) => call.path).sort(),
    ["/tm/projects", "/user/me", "/ws", "/ws/members", "/ws/tags"],
  );
  assert.equal("boards" in payload, false);
  assert.equal("columns" in payload, false);
  assert.deepEqual(payload["projects"], [{ id: 1, name: "Dev" }]);
});

test("a projectId adds that project's boards, a boardId that board's columns", async () => {
  const calls: Call[] = [];
  const payload = payloadOf(await captureTool(calls)({ projectId: 1, boardId: 143 }));

  assert.deepEqual(payload["boards"], [{ id: 143, name: "Sprint" }]);
  assert.deepEqual(payload["columns"], [{ id: 832, name: "In progress" }]);
  assert.equal(calls.find((call) => call.path === "/tm/boards")?.options.query?.["projectId"], 1);
  assert.equal(
    calls.find((call) => call.path === "/tm/board-columns")?.options.query?.["boardId"],
    143,
  );
});

test("the cached snapshot is reused, and refresh goes back to Weeek", async () => {
  // WorkspaceDirectory's own tests cover load(refresh); what is unpinned here is that this tool
  // passes the flag through at all. Without it the parameter reads as honoured and is not.
  const calls: Call[] = [];
  const handler = captureTool(calls);

  await handler({});
  await handler({});
  const afterTwoCalls = calls.length;
  await handler({ refresh: true });

  // Five endpoints build the directory: the second call must add none of them, the refresh all.
  assert.equal(afterTwoCalls, 5);
  assert.equal(calls.length, 10);
});
