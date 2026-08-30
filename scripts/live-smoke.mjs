// Read-only smoke test against a real Weeek workspace, run by hand, never by `npm test`.
//
//   npm run build && WEEEK_API_TOKEN=<token> node scripts/live-smoke.mjs
//
// It boots the built server over stdio exactly as a client would, prints what tools/list costs,
// and calls the two tools that only read. Nothing here writes to the tracker, and nothing here
// ever should: this runs against somebody's live workspace.

import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = fileURLToPath(new URL("../dist/server.mjs", import.meta.url));

if (!process.env.WEEEK_API_TOKEN?.trim()) {
  console.error("WEEEK_API_TOKEN is not set. This script talks to a real workspace and needs one.");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  env: { ...process.env },
});

const client = new Client({ name: "live-smoke", version: "1.0.0" });
let failed = false;

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const payload = JSON.stringify(tools);
  console.log(`tools: ${tools.length}`);
  console.log(
    `tools/list: ${payload.length} characters, about ${Math.round(payload.length / 3.5)} tokens`,
  );

  for (const call of [
    { name: "weeek_context", arguments: {} },
    { name: "weeek_search_tasks", arguments: { perPage: 3 } },
  ]) {
    const result = await client.callTool(call);
    const text = String(result.content?.[0]?.text ?? "");

    console.log(`\n=== ${call.name}${result.isError ? " FAILED" : ""} ===`);
    console.log(text.slice(0, 600));

    // A smoke test that prints an error and still exits 0 is one nobody notices failing.
    if (result.isError) failed = true;
  }
} finally {
  // Closing is what kills the spawned server. Left to process exit instead, a throw above would
  // report itself while the child was still running.
  await client.close();
}

if (failed) process.exitCode = 1;
