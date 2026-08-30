import { realpathSync, statSync } from "node:fs";
import { parse, resolve } from "node:path";


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

/**
 * Everything the environment supplies. Kept apart from WeeekConfig rather than folded into it: the
 * file root is nothing to do with talking to Weeek, and a client that had to carry it would make
 * every test that builds one carry it too, for a field the client never reads.
 */
export type ServerConfig = WeeekConfig & {
  /** The one directory the file tools may touch, resolved and real, or null when there is none. */
  fileRoot: string | null;
};

/**
 * Whether a resolved path is a filesystem root — the one shape a file root may not be.
 *
 * `parse(x).root === x` rather than a comparison against `sep`, because that comparison is only
 * true on POSIX: `C:\` and `\\server\share\` are roots that no separator equals. This predicate is
 * the general statement — exactly the set of paths that already end in a separator, on every
 * platform, with no branch to say so.
 *
 * The path flavour is a parameter for the same reason `loadConfig` takes an env: it is the only
 * way to run the Windows arithmetic from a machine that is not Windows, and an unrun branch of a
 * platform check is a claim rather than a check. `path.win32` behaves identically wherever it
 * executes, so config.test.ts drives this very function through both.
 */
export function isFilesystemRoot(
  resolved: string,
  path: { parse: (value: string) => { root: string } } = { parse },
): boolean {
  return path.parse(resolved).root === resolved;
}

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
 * Resolves WEEEK_FILE_ROOT: the only directory weeek_upload_attachment may read from and the only
 * one weeek_get_attachment may be pointed at.
 *
 * Why an operator sets this instead of the server working it out. This server feeds a model text
 * that other people wrote — task descriptions and comments — and it also holds a tool that reads
 * any local file and a tool that writes one, with the workspace itself as a channel back to
 * whoever wrote that text. The boundary between those has to be declared by someone the attacker
 * cannot reach through a comment, and the model is not that someone. A rule the server infers is a
 * rule the model can argue with; a directory the operator named is not.
 *
 * Returning null rather than throwing is the unset case, and it is not an error: the file tools
 * refuse and name this variable, while the other eleven work as before. A value that is *set* and
 * unusable does throw, because that is an operator who asked for something specific and did not
 * get it — silently ignoring it would leave them believing a boundary exists.
 *
 * A root of $HOME is honoured, not refused, and warned about instead — see {@link fileRootWarning}.
 * The rule this whole mechanism exists for is that the boundary is the operator's to declare rather
 * than the model's to argue with, and refusing what the operator declared would be a different rule.
 * A blacklist would also mislead: ~/IdeaProjects carries every project's .env and passes any such
 * check cleanly, so forbidding a couple of paths would suggest the rest are safe.
 *
 * A filesystem root is the exception, and it is refused for a different reason than danger. It is
 * what `WEEEK_FILE_ROOT="$SOMETHING_UNSET/"` collapses to, so it is far more often a substitution
 * that did not happen than a decision anybody made — and refusing it catches the accident rather
 * than overruling the choice. It is also the one shape the containment check cannot express: a root
 * already ends in a separator, so `root + sep` doubles it and nothing is under the result. Left
 * through, such a root would silently disable both tools while the warning said the opposite.
 *
 * The path is resolved through realpath once, here, so that every later comparison is between real
 * paths. Without that a symlink anywhere above the root would make containment a string game.
 */
function fileRoot(env: NodeJS.ProcessEnv): string | null {
  const declared = env["WEEEK_FILE_ROOT"]?.trim();
  if (!declared) return null;

  let resolved: string;
  try {
    resolved = realpathSync(resolve(declared));
  } catch {
    throw new ConfigError(
      `WEEEK_FILE_ROOT is set to ${declared}, which does not exist. It has to be a directory that ` +
        "is already there: the attachment tools resolve every path against it.",
    );
  }

  if (!statSync(resolved).isDirectory()) {
    throw new ConfigError(`WEEEK_FILE_ROOT is set to ${declared}, which is not a directory.`);
  }

  if (isFilesystemRoot(resolved)) {
    throw new ConfigError(
      `WEEEK_FILE_ROOT resolves to ${resolved}, a filesystem root, which is not a restriction — ` +
        'and is most often a variable that did not expand: WEEEK_FILE_ROOT="$UNSET_VAR/" ' +
        "collapses to exactly this. Name the one directory the attachment tools should be able " +
        "to reach.",
    );
  }

  return resolved;
}

/**
 * What to say on stderr when the named root is wide enough that it restricts almost nothing.
 *
 * A string rather than a write, so that the one place in this program that owns stderr keeps owning
 * it, and so this is testable without capturing output. server.ts prints it, once, at startup.
 *
 * One case: the home directory. `/` never reaches here, because fileRoot refuses it. This is not a
 * security control and does not pretend to be one — the operator's choice stands. It exists because
 * $HOME is the value somebody reaches for while getting the tools working and then forgets, and an
 * unread variable in a config file is a poor place to discover that ~/.ssh is in scope.
 *
 * The file tools repeat it in their answers, because stderr from a stdio server is the channel a
 * person is least likely to be looking at — Claude Code files it away in a log.
 */
export function fileRootWarning(
  fileRoot: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (fileRoot === null) return null;

  // USERPROFILE beside HOME: Windows sets the second and usually not the first, and a warning
  // that can never fire on a platform is the same as not having written it.
  const home = (env["HOME"] ?? env["USERPROFILE"])?.trim();
  if (home === undefined || home === "" || fileRoot !== realpathOrSelf(home)) return null;

  return (
    `WEEEK_FILE_ROOT is ${fileRoot}, your home directory, so the attachment tools can read and ` +
    "write ~/.ssh, ~/.aws, ~/.config and every project's .env. That is what the configuration " +
    "says rather than a fault, but this server shows a model text written by other people, and " +
    "those tools take their paths from it. Name a narrower directory to change it."
  );
}

/** realpath where it works, the path as given where it does not — this is only used to compare. */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const token = env["WEEEK_API_TOKEN"]?.trim();
  if (!token) {
    throw new ConfigError(
      "WEEEK_API_TOKEN is not set and no token is stored on this machine. Either run " +
        "`weeek-mcp init`, which asks for a token, checks it with Weeek and keeps it in the " +
        "system keychain, or create a token in your Weeek workspace settings (API section) and " +
        "pass it in the MCP server environment.",
    );
  }

  return {
    token,
    baseUrl: (env["WEEEK_BASE_URL"]?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: positiveInteger(env["WEEEK_TIMEOUT_MS"]) ?? DEFAULT_TIMEOUT_MS,
    fileRoot: fileRoot(env),
  };
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
