import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES, registerAllTools } from "./index.ts";

/**
 * What a client actually receives, rather than what we believe we registered.
 *
 * The context is two `{} as never`: nothing here has an API to talk to, so a register function
 * that reached for the client or the directory while registering — instead of from inside its
 * handler — would throw here rather than register. That is the point of passing them empty.
 */
async function listTools(): Promise<Tool[]> {
  const server = new McpServer({ name: "weeek-mcp", version: "0.1.0" });
  registerAllTools(server, { client: {} as never, directory: {} as never });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test("the server registers exactly the twelve tools TOOL_NAMES declares", async () => {
  // The two sides are independent: each tool names itself in its own register call, and nothing
  // in the source reads TOOL_NAMES back. So this catches a tool added, renamed or dropped without
  // the list following it — the drift a list nobody checks always ends in.
  const names = (await listTools()).map((tool) => tool.name).sort();
  assert.deepEqual(names, [...TOOL_NAMES].sort());
  assert.equal(TOOL_NAMES.length, 12);
});

test("read tools declare readOnlyHint and the deletion declares destructiveHint", async () => {
  const byName = new Map((await listTools()).map((tool) => [tool.name, tool]));

  assert.equal(byName.get("weeek_get_task")?.annotations?.readOnlyHint, true);
  assert.equal(byName.get("weeek_delete_comment")?.annotations?.destructiveHint, true);
});

test("the tool list stays cheap in context", async () => {
  const payload = JSON.stringify(await listTools());

  // Two bounds, because they defend two different things.
  //
  // The loose one defends the premise. A tool per API operation gave 157 tools and some 126 000
  // characters — about 36 000 tokens on every single request, against 3 700 for these twelve.
  // It fires the moment someone generates the other 145 back, and it never fires because a
  // description grew a sentence, so nobody ever has a reason to switch it off.
  assert.ok(payload.length < 30_000, `tools/list grew to ${payload.length} characters`);

  // The tight one defends the number, which is this project's whole identity. At 13 029 characters
  // today it leaves real room, and it catches the gradual creep that 30 000 would wave through at
  // more than double what the tool set costs now.
  assert.ok(payload.length < 18_000, `tools/list crept up to ${payload.length} characters`);
});

/**
 * Every argument a tool declares, split into the ones a caller must give and the ones it need not,
 * read off what the client was actually served rather than off the source.
 */
function argumentsOf(tool: Tool): { optional: [string, Record<string, unknown>][] } {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((tool.inputSchema.required as string[] | undefined) ?? []);
  return { optional: Object.entries(properties).filter(([name]) => !required.has(name)) };
}

/** Whether the served JSON Schema for one argument offers null as one of the things it takes. */
function takesNull(schema: Record<string, unknown>): boolean {
  const branches = schema["anyOf"];
  return (
    Array.isArray(branches) &&
    branches.some((branch) => (branch as Record<string, unknown>)["type"] === "null")
  );
}

test("null tolerance costs the schema nothing, and weeek_update_task is the one exception", async () => {
  // The property that makes accepting null free, checked over the whole set so a tool added later
  // cannot quietly reintroduce the cost. nullAsAbsent takes null at parse time without declaring
  // it, so what a client is served must still be the plain type: a concrete `type`, no `anyOf`,
  // and — the failure worth guarding hardest — not a degenerate `{}`, which is what
  // `z.unknown().pipe(...)` would emit and would leave the model unable to see the type at all.
  for (const tool of await listTools()) {
    // Every argument, not only the optional ones. A degenerate wrapper does not merely blank the
    // type — it also drops zod's optionality mark, so the argument turns up as *required* and a
    // loop over the optional ones would walk straight past the damage it was written to catch.
    const properties = (tool.inputSchema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [name, schema] of Object.entries(properties)) {
      assert.ok(
        Object.keys(schema).length > 0,
        `${tool.name}.${name} is served as {} — the model can see neither its type nor its bounds`,
      );
    }

    for (const [name, schema] of argumentsOf(tool).optional) {
      // The exception, and it is a declaration rather than an oversight: on this one tool null is
      // a value Weeek acts on — it clears the field — so it is worth the anyOf that announces it.
      if (tool.name === "weeek_update_task") continue;

      const where = `${tool.name}.${name}`;
      assert.ok(!takesNull(schema), `${where} declares null again — that is the 1 120 characters`);
      assert.equal(typeof schema["type"], "string", `${where} lost its type`);
    }
  }
});

test("weeek_update_task keeps null meaning clear, and still refuses it where it must", async () => {
  const byName = new Map((await listTools()).map((tool) => [tool.name, tool]));
  const update = byName.get("weeek_update_task");
  assert.ok(update !== undefined);

  const properties = update.inputSchema.properties as Record<string, Record<string, unknown>>;
  // The five that clear. Named one by one because this is the exception to the rule above, and an
  // exception that is not written down is indistinguishable from an oversight.
  for (const field of ["priority", "type", "startDate", "dueDate", "duration"]) {
    const schema = properties[field];
    assert.ok(schema !== undefined && takesNull(schema), `${field} should still take null`);
  }

  // And the two that do not. A task with no title is a state nobody wants, and null on the tag
  // list is ambiguous between "leave them" and "remove them all" — an empty array says the latter.
  for (const field of ["title", "tags"]) {
    const schema = properties[field];
    assert.ok(schema !== undefined && !takesNull(schema), `${field} should refuse null`);
  }
});

test("every tool refuses an argument it never declared", async () => {
  // The rule, over the whole set rather than the one tool the finding was noticed on. A tool added
  // later with a bare `{...}` shape instead of z.strictObject registers happily, serves a schema
  // with no additionalProperties, and silently drops whatever the model misspells — so this reads
  // what a client is actually served and fails the build rather than letting it slip through.
  //
  // It is also **the only thing standing between us and a much worse mistake**, and that is worth
  // knowing before anyone weakens it. Wrapping a whole tool schema — `z.preprocess(fn,
  // z.strictObject({...}))`, which looks like the tidy way to handle null in one place — makes
  // `normalizeObjectSchema` return undefined, and the SDK quietly serves EMPTY_OBJECT_JSON_SCHEMA:
  // `{"type":"object","properties":{}}`. The tool is still registered, still listed, and still
  // validates correctly, because validation falls back to the pipe — so `tsc` is silent and every
  // behavioural test in this repository stays green while the model is told the tool takes no
  // arguments at all. Measured: doing that to one tool turns exactly this assertion red and
  // nothing else.
  const tools = await listTools();
  assert.equal(tools.length, 12);

  for (const tool of tools) {
    assert.equal(
      tool.inputSchema.additionalProperties,
      false,
      `${tool.name} accepts undeclared arguments — its inputSchema is not a z.strictObject`,
    );
  }
});
