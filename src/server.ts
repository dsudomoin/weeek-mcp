#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, assertSupportedNode, fileRootWarning, loadConfig } from "./config.ts";
import { WeeekClient } from "./http/client.ts";
import { WeeekApiError, describeApiError } from "./http/quirks.ts";
import { serverIdentity } from "./identity.ts";
import { registerAllTools } from "./tools/index.ts";
import { WorkspaceDirectory } from "./weeek/directory.ts";

/**
 * The environment the rest of startup reads, with a stored token filled in only where the
 * environment left a gap.
 *
 * This is what makes "WEEEK_API_TOKEN wins" true by construction rather than by a rule someone has
 * to remember: loadConfig is handed an environment that has already been resolved, and it neither
 * knows nor can know that a keychain exists. It matters for the two clients that need it most —
 * Codex clears the environment and substitutes its own, and a container has no keychain at all.
 *
 * The other half is cost, and it is why secrets.ts is imported here rather than at the top of the
 * file. When the variable is set this returns before reaching the import, so that module — and the
 * `node:child_process` it pulls in for the Windows fallback — is never loaded, no native binding is
 * touched, and startup costs exactly what it did before any of this existed. Measured: a static
 * import of it was worth about 20 ms on every start, paid by every user whose token comes from the
 * environment, which is all of them on the plugin route.
 */
async function resolveEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (process.env["WEEEK_API_TOKEN"]?.trim()) return process.env;

  const { readStoredToken } = await import("./secrets.ts");
  const stored = await readStoredToken();
  return stored === null ? process.env : { ...process.env, WEEEK_API_TOKEN: stored };
}

async function main(): Promise<void> {
  // Ahead of the token check: telling someone which variable to set is no help while the runtime
  // beneath them cannot run this server at all.
  assertSupportedNode();

  // Before anything else reads configuration: `init` is the subcommand whose whole purpose is that
  // there is no token yet, so it must not be refused by the check for one.
  // Imported here rather than at the top of the file: the wizard drags in an HTTP client and the
  // secret layer, and a server started normally has no use for either. Every start would pay for
  // a path taken once in the life of an installation.
  if (process.argv[2] === "init") {
    const { runInit } = await import("./cli/init.ts");
    await runInit();
    return;
  }

  const config = loadConfig(await resolveEnvironment());

  // A root this wide is the operator's decision and is honoured; this is only so that it is a
  // decision they know they made. Said here at startup, and again by the file tools in their own
  // answers — stderr from a stdio server is the channel a person is least likely to be reading.
  const warning = fileRootWarning(config.fileRoot);
  if (warning !== null) console.error(warning);

  const client = new WeeekClient(config);

  const server = new McpServer(serverIdentity());

  // Without this, every transport and protocol error after connect is swallowed: the SDK's own
  // handler is `this.onerror?.(error)`, and nothing sets onerror. A failed send, a frame that will
  // not parse or a broken stdin would leave no trace anywhere — and stderr is the only channel
  // this process has to say anything on.
  server.server.onerror = (error) => {
    console.error(error);
  };

  registerAllTools(server, {
    client,
    directory: new WorkspaceDirectory(client),
    fileRoot: config.fileRoot,
    fileRootWarning: warning,
  });

  // Nothing is fetched here: the workspace is loaded by the first tool call that needs it, so a
  // client that starts this server and asks nothing of it costs the API no requests at all.
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  // A ConfigError is this program refusing a situation it understands, and a WeeekApiError is
  // Weeek doing the same; both messages are written for whoever has to act on them, and a stack
  // would only bury the sentence. Anything else is a defect, and one context-free line — no type,
  // no file, no frame, no cause — is not enough to find one, so the whole error goes out.
  const explained =
    error instanceof ConfigError
      ? error.message
      : error instanceof WeeekApiError
        ? describeApiError(error)
        : undefined;

  // stdout is the JSON-RPC channel, so diagnostics only ever go to stderr.
  console.error(explained ?? error);

  // Not process.exit(1): writes to a piped stderr are asynchronous on macOS, and exiting outright
  // would cut the line above off before it was written — losing exactly the message that tells a
  // new user their token is missing. Setting the code lets the process end once stderr has
  // drained, and there is nothing left to keep it alive: every failure reachable here happens
  // before the transport attaches its stdin listener, which is the last thing connect() does.
  process.exitCode = 1;
});
