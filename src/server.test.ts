import { execFile, spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOL_NAMES } from "./tools/index.ts";

const SERVER = fileURLToPath(new URL("./server.ts", import.meta.url));
const BREAK_STDIN = new URL("./testing/unavailable-stdin.ts", import.meta.url).href;
// Every test below that cares what is *stored* runs the server behind this. Without it the server
// reads the developer's own login keychain, and the suite passes only for people who have never
// run `weeek-mcp init` — see the file's own comment.
const NO_KEYCHAIN = ["--import", new URL("./testing/no-system-keychain.ts", import.meta.url).href];

// Built by hand rather than inherited: the real WEEEK_API_TOKEN is usually in the environment this
// suite runs in, and a test about a missing token must not be handed one. Typed as
// Record<string, string> because StdioClientTransport takes the stricter of the two — ProcessEnv
// admits undefined values.
const PATH_ONLY: Record<string, string> = { PATH: process.env["PATH"] ?? "" };
const WITH_TOKEN: Record<string, string> = { ...PATH_ONLY, WEEEK_API_TOKEN: "boot-test-token" };

type Finished = { code: unknown; stdout: string; stderr: string };

function runToCompletion(env: Record<string, string>, nodeArgs: string[] = []): Promise<Finished> {
  return new Promise((resolve) => {
    const args = [...nodeArgs, SERVER];
    execFile(process.execPath, args, { env, timeout: 20_000 }, (error, stdout, stderr) =>
      resolve({ code: error?.code, stdout, stderr }),
    );
  });
}

test("a missing token is reported as one sentence, and stdout stays clean", async () => {
  // The first thing every new user hits. It has to arrive as a sentence naming the variable —
  // not as an unhandled rejection — and it must not go to stdout, which is the protocol channel.
  //
  // NO_KEYCHAIN is what makes "missing" mean missing. On a machine where the wizard has been run
  // this server would otherwise find a real token, start normally, and leave the test waiting for
  // an exit that never comes.
  const { code, stdout, stderr } = await runToCompletion(PATH_ONLY, NO_KEYCHAIN);

  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /WEEEK_API_TOKEN is not set/);
  // No stack: this is the program refusing a situation it understands, and a trace would only
  // bury the one line the reader has to act on.
  assert.doesNotMatch(stderr, /\n\s+at /);
});

test("an unexpected failure is reported in full", async () => {
  // The other half of that decision. A bug reported as `error.message` alone arrives as one
  // context-free line — here, literally "Cannot read properties of undefined (reading 'on')" —
  // with no type, no file and no frame to find it by.
  const { code, stdout, stderr } = await runToCompletion(WITH_TOKEN, ["--import", BREAK_STDIN]);

  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /TypeError/);
  assert.match(stderr, /\n\s+at /);
});

test("a malformed frame is reported instead of vanishing", { timeout: 20_000 }, async () => {
  // The SDK's own handler is `this.onerror?.(error)` and nothing sets onerror by default, so
  // every transport and protocol error after connect is swallowed whole. This is that blind spot:
  // a line of nonsense on stdin, which the read buffer cannot parse and no one would ever hear
  // about.
  const child = spawn(process.execPath, [SERVER], { env: WITH_TOKEN, stdio: "pipe" });

  try {
    const { stdin, stderr } = child;
    assert.ok(stdin !== null && stderr !== null);
    stderr.setEncoding("utf8");

    const reported = new Promise<string>((resolve) => {
      stderr.once("data", resolve);
    });
    // Bounded, and unref'd so the timer holds nothing open. Without it the failure mode of this
    // test is a wait that never ends: a swallowed error leaves the child alive with its pipes
    // held, and the whole run hangs instead of failing.
    const silence = new Promise<never>((_, reject) => {
      const swallowed = new Error("nothing reached stderr — onerror is unset");
      setTimeout(() => reject(swallowed), 5_000).unref();
    });
    stdin.write("this is not a json-rpc frame\n");

    assert.match(await Promise.race([reported, silence]), /SyntaxError/);
  } finally {
    child.kill();
  }
});

test("the server boots over stdio and serves the whole tool set", { timeout: 30_000 }, async () => {
  // The entry point end to end: config, client, directory, registration and the stdio transport,
  // over a real child process. The token is a fake one on purpose — a tools/list must not need
  // the API, and registering must not call it.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: WITH_TOKEN,
  });
  const client = new Client({ name: "server-test", version: "1.0.0" });

  try {
    await client.connect(transport);

    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...TOOL_NAMES].sort());
  } finally {
    await client.close();
  }
});

/**
 * A stand-in Weeek that records the token it was called with.
 *
 * The priority of the environment over stored credentials cannot be observed from outside any
 * other way: both paths end in a server that starts and serves the same thirteen tools. What
 * differs is the bearer token on the wire, so that is what gets read.
 */
async function recordingWeeek(): Promise<{ url: string; tokens: string[]; close: () => void }> {
  const { createServer } = await import("node:http");
  const tokens: string[] = [];

  const http = createServer((request, response) => {
    tokens.push((request.headers.authorization ?? "").replace(/^Bearer /, ""));
    response.writeHead(200, { "content-type": "application/json" });
    // Enough of a workspace for weeek_context to answer rather than fail on the shape.
    response.end(
      JSON.stringify({ success: true, user: {}, workspace: {}, members: [], tags: [], projects: [] }),
    );
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, tokens, close: () => http.close() };
}

/** Starts the server, makes one call that reaches the API, and hands back the tokens observed. */
async function tokenReachingWeeek(env: Record<string, string>): Promise<string | undefined> {
  const weeek = await recordingWeeek();
  const transport = new StdioClientTransport({
    command: process.execPath,
    // Behind NO_KEYCHAIN for the reason given where it is declared: these tests are about which
    // *stored* token wins, and a real keychain entry would answer before the fixture did.
    args: [...NO_KEYCHAIN, SERVER],
    env: { ...env, WEEEK_BASE_URL: weeek.url },
  });
  const client = new Client({ name: "test", version: "1.0.0" });

  try {
    await client.connect(transport);
    await client.callTool({ name: "weeek_context", arguments: {} });
    return weeek.tokens[0];
  } finally {
    await client.close();
    weeek.close();
  }
}

test("a stored token starts a server the environment left tokenless", { timeout: 30_000 }, async () => {
  // The whole point of the wizard: a client stanza that names no token at all still brings the
  // server up, because the token is on the machine rather than in the configuration.
  const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const configHome = mkdtempSync(join(tmpdir(), "weeek-server-"));
  mkdirSync(join(configHome, "weeek-mcp"));
  writeFileSync(
    join(configHome, "weeek-mcp", "token.json"),
    JSON.stringify({ token: "stored-token", encryption: "none" }),
  );

  try {
    // XDG_CONFIG_HOME with no DBUS_SESSION_BUS_ADDRESS is the one combination that reaches the
    // file on any machine, and NO_KEYCHAIN is what puts the server on that combination.
    const observed = await tokenReachingWeeek({ ...PATH_ONLY, XDG_CONFIG_HOME: configHome });

    // Equality, not "is a string": this is also the assertion that proves the isolation held. If
    // the real keychain were reached, the value here would be whoever's token is in it.
    assert.equal(observed, "stored-token");
  } finally {
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("the environment beats a stored token, which is what keeps containers working", { timeout: 30_000 }, async () => {
  // Not a preference but a requirement. Codex clears the environment and substitutes its own, and
  // a container has no keychain at all; a stored token that could shadow WEEEK_API_TOKEN would
  // make both unmanageable, and the failure would look like the server ignoring its configuration.
  const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const configHome = mkdtempSync(join(tmpdir(), "weeek-server-"));
  mkdirSync(join(configHome, "weeek-mcp"));
  writeFileSync(
    join(configHome, "weeek-mcp", "token.json"),
    JSON.stringify({ token: "stored-token", encryption: "none" }),
  );

  try {
    const observed = await tokenReachingWeeek({
      ...PATH_ONLY,
      XDG_CONFIG_HOME: configHome,
      WEEEK_API_TOKEN: "environment-token",
    });
    assert.equal(observed, "environment-token");
  } finally {
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("weeek-mcp init refuses a stdin that is not a terminal, and writes nothing to stdout", async () => {
  // The refusal is what makes the slash command's instruction hold when it is ignored. Reading a
  // token from a pipe would put it wherever that pipe came from — a model's transcript, most
  // likely — which is the one outcome storing it in a keychain exists to prevent.
  const finished = await new Promise<Finished>((resolve) => {
    const child = execFile(
      process.execPath,
      [SERVER, "init"],
      { env: PATH_ONLY, timeout: 20_000 },
      (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr }),
    );
    child.stdin?.end("a-token-from-a-pipe\n");
  });

  assert.equal(finished.code, 1);
  assert.equal(finished.stdout, "");
  assert.match(finished.stderr, /needs a terminal/);
  // And it names the way out, so nobody is left with a wizard they cannot run.
  assert.match(finished.stderr, /WEEEK_API_TOKEN/);
});
