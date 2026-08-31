/**
 * A refusal, not a bug: something the environment has to supply is missing or unusable.
 *
 * It exists so that server.ts can tell the two apart. A ConfigError is a situation this program
 * understands, and its message is written for whoever has to fix it — one sentence, no stack.
 * Anything else reaching that handler is a defect, and gets reported with everything it carries.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** What the HTTP client needs, and nothing else — it is the only reader of this type. */
export type WeeekConfig = {
  token: string;
  baseUrl: string;
  timeoutMs: number;
};

/** The floor `engines` in package.json declares. config.test.ts is what holds the two together. */
const MINIMUM_NODE = { major: 22, minor: 18 };

/**
 * Refuses to run on a Node older than the one this server is declared to support.
 *
 * `engines` is advisory everywhere it is read and unread where it would matter most: npm only
 * warns, and installing this as a Claude Code plugin never consults a manifest at all. So the
 * declared floor is enforced here or nowhere.
 *
 * What this can and cannot catch is worth being exact about. Node parses a whole module graph
 * before evaluating any of it, and the plugin bundle is a single file parsed whole, so syntax an
 * old Node could not read would fail long before this function was reached. Today nothing carries
 * any: esbuild's output for targets node18 through node25 is byte-identical, so no source in the
 * bundle — ours or a dependency's — is newer than that. The check therefore does run, and what it
 * buys is not rescuing a parse error but refusing in words rather than running untried.
 *
 * It throws instead of calling process.exit so that every refusal this program understands leaves
 * by one route — the handler at the foot of server.ts, which prints a ConfigError as a sentence
 * rather than a stack and lets the process end on its own. Not because process.exit would have cut
 * the message off: that starts at the pipe's capacity, some 64 KB, and this one is 216 bytes.
 */
export function assertSupportedNode(version: string = process.versions.node): void {
  const parts = /^(\d+)\.(\d+)/.exec(version);

  // A version string we cannot read is far likelier to be something new than something old, and
  // refusing to start over our own failure to parse would be the worse of the two outcomes.
  if (parts === null) return;

  const [, major = "0", minor = "0"] = parts;
  const supported =
    Number(major) > MINIMUM_NODE.major ||
    (Number(major) === MINIMUM_NODE.major && Number(minor) >= MINIMUM_NODE.minor);

  if (!supported) {
    throw new ConfigError(
      `weeek-mcp needs Node ${MINIMUM_NODE.major}.${MINIMUM_NODE.minor} or newer, and this is ` +
        `Node ${version}. Upgrade Node, or point this server's command at a newer binary: an MCP ` +
        `client launches the server itself, so the node it finds is not necessarily yours.`,
    );
  }
}

const DEFAULT_BASE_URL = "https://api.weeek.net/public/v1";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Where to talk to Weeek and for how long — everything the HTTP client needs except the token.
 *
 * Split out of loadConfig because the wizard needs exactly this and none of the rest: it has the
 * token in its hand rather than in the environment, and loadConfig refuses outright when the
 * environment carries none — which is the situation `weeek-mcp init` exists to end.
 *
 * One function rather than two copies so that a self-hosted or proxied endpoint is honoured in
 * both. It was not, and the wizard's hardcoded address made a token uncheckable on such a machine.
 */
export function endpoint(env: NodeJS.ProcessEnv = process.env): Omit<WeeekConfig, "token"> {
  return {
    baseUrl: (env["WEEEK_BASE_URL"]?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: positiveInteger(env["WEEEK_TIMEOUT_MS"]) ?? DEFAULT_TIMEOUT_MS,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WeeekConfig {
  const token = env["WEEEK_API_TOKEN"]?.trim();
  if (!token) {
    throw new ConfigError(
      "WEEEK_API_TOKEN is not set and no token is stored on this machine. Either run " +
        "`weeek-mcp init`, which asks for a token, checks it with Weeek and keeps it in the " +
        "system keychain, or create a token in your Weeek workspace settings (API section) and " +
        "pass it in the MCP server environment.",
    );
  }

  return { token, ...endpoint(env) };
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
