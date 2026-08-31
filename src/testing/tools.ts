import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { RequestOptions } from "../http/client.ts";
import type { WeeekOperation } from "../openapi-types.ts";
import { registerAllTools } from "../tools/index.ts";
import type { ToolContext } from "../tools/shared.ts";
import { WorkspaceDirectory } from "../weeek/directory.ts";

/**
 * The plumbing a tool test needs: a client that answers per path, a workspace to resolve names
 * against, and a way to get at the handler a register function hands to the server.
 *
 * It lives outside `*.test.ts` so four test files can share it, and outside the build because
 * `tsconfig.json` excludes this directory — `npm run check` still type-checks it.
 *
 * What deliberately does NOT live here is any expectation. The rendered thread in particular is
 * written out separately in each file that asserts it: "the thread reads the same inside the card
 * as it does on its own" is only worth something while the two sides are written independently,
 * and a shared constant would let both drift together and stay green.
 */

export type Call = { path: string; options: RequestOptions };
export type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;
// registerTool's own config type is the SDK's, and only these three fields are ever read here.
export type ToolConfig = {
  annotations?: unknown;
  description?: string;
  // A ZodObject rather than a raw shape since every tool became strict, which is why nothing may
  // index this directly any more — use shapeOf.
  inputSchema?: unknown;
};

/**
 * The arguments a captured tool declares, by name.
 *
 * Every tool registers `z.strictObject(...)`, so its fields live behind `.shape` rather than on
 * the config object itself. Indexing the config would answer `undefined` for every field and quietly
 * turn a test that reads a description or counts arguments into one that asserts nothing — so this
 * asserts the object is really there instead of coping with its absence, which also makes it the
 * one place that notices a tool registered a bare shape and lost its strictness.
 */
export function shapeOf(config: ToolConfig): Record<string, z.ZodType> {
  const schema = config.inputSchema;
  assert.ok(
    schema instanceof z.ZodObject,
    "the tool did not register a z.strictObject, so unknown arguments would be silently dropped",
  );
  return schema.shape as Record<string, z.ZodType>;
}

export function stubClient(byPath: Record<string, unknown>, calls: Call[] = []) {
  return {
    async request(operation: WeeekOperation, options: RequestOptions = {}): Promise<unknown> {
      calls.push({ path: operation.path, options });
      const answer = byPath[operation.path];
      // A stub that can fail is what lets a rejected call be exercised through the real handler.
      if (answer instanceof Error) throw answer;
      return answer ?? {};
    },
  };
}

/** The five endpoints a directory is built from, with two people, one tag and one project. */
export function workspaceResponses(): Record<string, unknown> {
  return {
    "/user/me": { success: true, user: { id: "u-me", firstName: "Denis", lastName: "S" } },
    "/ws": { success: true, workspace: { id: 1, title: "FunTime" } },
    "/ws/members": { success: true, members: [{ id: "u-2", firstName: "Anna", lastName: "K" }] },
    "/ws/tags": { success: true, tags: [{ id: 51, title: "bug" }] },
    "/tm/projects": { success: true, projects: [{ id: 1, name: "Dev" }] },
  };
}

/** A context over the workspace above, plus whatever the test wants the other paths to answer. */
export function toolContext(
  responses: Record<string, unknown> = {},
  calls: Call[] = [],
): ToolContext {
  const client = stubClient({ ...workspaceResponses(), ...responses }, calls);
  return { client: client as never, directory: new WorkspaceDirectory(client as never) };
}

export type Captured = { handler: Handler; name: string; config: ToolConfig };

/** registerTool is the only thing a register function touches, so this is a recorder, not a server. */
export function captureTools(
  register: (server: McpServer, context: ToolContext) => void,
  context: ToolContext,
): Map<string, Captured> {
  const captured = new Map<string, Captured>();
  const server = {
    registerTool(name: string, config: ToolConfig, callback: Handler) {
      captured.set(name, { handler: callback, name, config });
    },
  };

  register(server as never as McpServer, context);
  assert.ok(captured.size > 0, "nothing registered itself");
  return captured;
}

/** The one tool a register function registers. Registering a second one is the caller's mistake. */
export function captureTool(
  register: (server: McpServer, context: ToolContext) => void,
  context: ToolContext,
): Captured {
  const tools = captureTools(register, context);
  const [only] = tools.values();
  assert.ok(
    only !== undefined && tools.size === 1,
    `expected one tool, got ${[...tools.keys()].join(", ")}`,
  );
  return only;
}

/**
 * A real server and a real client, joined in memory, for the tests that cannot use captureTools.
 *
 * captureTools records the callback and calls it directly, which is right for a handler's own
 * logic and useless for anything the schema decides. Validation lives in the SDK, above the
 * callback: it is what parses the arguments, what turns null into an absent argument, and what
 * refuses an argument nobody declared now that every shape is a z.strictObject. Reaching the
 * callback by hand means none of that has run, so a test written that way would pass whatever the
 * schema said — which is exactly how the two findings behind these tests went unnoticed.
 *
 * So this goes the long way round on purpose: registerAllTools onto an McpServer, a Client over
 * InMemoryTransport, and `tools/call` down the wire. What it proves is what a client actually gets.
 */
export async function connectedServer(context: ToolContext): Promise<{
  call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = new McpServer({ name: "weeek-mcp", version: "0.1.0" });
  registerAllTools(server, context);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    call: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: () => client.close(),
  };
}

export function textOf(result: CallToolResult): string {
  const first = result.content[0];
  assert.ok(first !== undefined && first.type === "text");
  return first.text;
}

export function payloadOf(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

export function comment(id: number, parentId: number | null, authorId: string, at: string) {
  return { id, parentId, authorId, markdown: `text ${id}`, createdAt: at, updatedAt: at };
}

/** Two comments in the order the wire delivers them — newest first, the reply ahead of its root. */
export function thread() {
  return [
    comment(2, 1, "u-2", "2026-08-22T11:00:00Z"),
    comment(1, null, "u-me", "2026-08-22T10:00:00Z"),
  ];
}
