import { ConfigError, endpoint } from "../config.ts";
import { WeeekClient } from "../http/client.ts";
import { WeeekApiError, describeApiError, asRecord } from "../http/quirks.ts";
import { readStoredToken, saveToken } from "../secrets.ts";
import { OPS } from "../weeek/operations.ts";

/**
 * `weeek-mcp init` — the wizard that sets up the one thing nobody should have to put in a
 * configuration file by hand: the Weeek API token.
 *
 * Two decisions shape all of it.
 *
 * **Everything is written to stderr, never stdout.** This is the same executable as the server, and
 * for the server stdout is the JSON-RPC channel. Keeping every byte of human-facing output on
 * stderr means there is no branch of this program that can write to stdout, which is a stronger
 * guarantee than remembering which mode we are in — and no worse for the user, because a terminal
 * shows both. It is also why `console.log` still appears nowhere under `src/`.
 *
 * **Nothing is stored until Weeek has accepted the token.** A token saved and then found to be
 * wrong is worse than no token: the failure surfaces later, inside a tool call, where it looks like
 * a bug in the server rather than a typo in a setup step.
 */

/** Written to stderr for the reason given above. */
function say(line = ""): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Reads a secret from the terminal with nothing echoed.
 *
 * Refuses outright when stdin is not a terminal, and that refusal is the point rather than a
 * limitation. Without it, a model asked to "set up the server" could run this wizard itself and
 * pipe a token in — and the token would then be sitting in the conversation transcript, which is
 * exactly what storing it in a keychain was meant to avoid. The slash command tells the model not
 * to; this is what makes that instruction hold when it is ignored.
 */
function requireTerminal(): void {
  if (process.stdin.isTTY) return;

  throw new ConfigError(
    "weeek-mcp init needs a terminal: it reads the token without echoing it, and it cannot do " +
      "that when its input is a pipe or a file. Run it yourself in a terminal. If you are " +
      "automating a setup, set WEEEK_API_TOKEN in the server's environment instead — that path " +
      "takes priority over anything stored here and needs no wizard.",
  );
}

async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  requireTerminal();

  process.stderr.write(prompt);
  input.setRawMode(true);
  input.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      let typed = "";

      const onData = (chunk: Buffer): void => {
        for (const byte of chunk) {
          // Enter, on either line ending.
          if (byte === 0x0d || byte === 0x0a) {
            input.off("data", onData);
            say();
            resolve(typed);
            return;
          }
          // Ctrl-C, and Ctrl-D on an empty line. Raw mode means no signal is delivered, so
          // abandoning has to be handled here or the only way out is closing the terminal.
          if (byte === 0x03 || (byte === 0x04 && typed === "")) {
            input.off("data", onData);
            say();
            reject(new ConfigError("Cancelled. Nothing was stored."));
            return;
          }
          // Backspace and delete, so a mistyped character can be taken back on a line nobody sees.
          if (byte === 0x7f || byte === 0x08) {
            typed = typed.slice(0, -1);
            continue;
          }
          // Anything else below space is a control sequence — an arrow key arrives as three bytes
          // — and letting those into the value would put invisible characters in the token.
          if (byte >= 0x20) typed += String.fromCharCode(byte);
        }
      };

      input.on("data", onData);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}

/**
 * The one request the wizard makes: proves the token works, and says whose it is.
 *
 * GET, and the cheapest one there is. It runs before anything is stored, because a token saved and
 * then found to be wrong is worse than no token — the failure surfaces later, inside a tool call,
 * where it looks like a bug in the server rather than a typo in a setup step.
 *
 * The endpoint comes from the environment, exactly as the server's does. It used to be written in
 * here, which meant that on a self-hosted or proxied Weeek the wizard checked the wrong host and
 * refused a token that was perfectly good — an inconsistency inside one package.
 *
 * Exported so this can be tested against a real HTTP server rather than reasoned about: the wizard
 * around it needs a terminal, and would be untestable end to end. `client` is a seam for the same
 * reason WeeekClient itself takes a sleep: the client retries a request it could not send four
 * times with backoff, which is right for a person waiting at a prompt and four wasted seconds in a
 * suite.
 */
export async function checkToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  client: Pick<WeeekClient, "request"> = new WeeekClient({ token, ...endpoint(env) }),
): Promise<string | null> {
  try {
    return nameFromProfile(await client.request(OPS.getProfile));
  } catch (error) {
    if (error instanceof WeeekApiError) {
      throw new ConfigError(
        `Weeek rejected that token, so nothing was stored.\n${describeApiError(error)}`,
      );
    }
    throw new ConfigError(
      `Could not reach Weeek to check the token, so nothing was stored. ${reasonOf(error)}`,
    );
  }
}

/** The name Weeek answers with, so the wizard can say who was authenticated rather than "ok". */
function nameFromProfile(payload: unknown): string | null {
  const user = asRecord(asRecord(payload)?.["user"]);
  const parts = [user?.["firstName"], user?.["lastName"]].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return parts.length === 0 ? null : parts.join(" ");
}

export async function runInit(): Promise<void> {
  // First, before anything is read. readSecret refuses on its own too, but doing it here is what
  // keeps a run that is going to be refused from reading the keychain on its way to the refusal.
  requireTerminal();

  say("weeek-mcp setup");
  say();

  await configureToken();

  say();
  say("Restart your client, or reconnect the server inside it, before using it. The token is read");
  say("once, when the server starts, so a client that is already running does not have it.");
}

/**
 * Asks for the token, checks it, stores it, and says where it went.
 *
 * An already-stored token can be kept with Enter, and that is not politeness. This wizard is also
 * how somebody finds out *where* their token ended up — the line naming the store is the whole
 * answer on a machine with no usable keychain — and a run that demanded the token again to tell
 * them that would push them towards keeping it somewhere easier to copy from.
 */
async function configureToken(): Promise<void> {
  // Read before asking, so the prompt can offer to keep what is there. The server does this on
  // every start; doing it once here costs the same and nothing is printed.
  const stored = await readStoredToken();

  say("Create a token in Weeek under Settings -> API, then paste it below.");
  say("It is not shown as you type, and it is not stored until Weeek accepts it.");
  say();

  const prompt =
    stored === null ? "Weeek API token: " : "Weeek API token, or Enter to keep the stored one: ";
  const token = (await readSecret(prompt)).trim();

  if (token === "") {
    if (stored === null) throw new ConfigError("No token was entered. Nothing was stored.");
    say("Keeping the token already stored. It was checked with Weeek when it was saved.");
    return;
  }

  say("Checking it with Weeek...");

  const who = await checkToken(token);
  say(who === null ? "Accepted." : `Accepted — signed in as ${who}.`);

  const outcome = await saveToken(token);

  say();
  // The store is named, never just "saved". On Linux especially, "saved" is a word that can hide a
  // write to the kernel session keyring that will not survive a reboot; naming the place is what
  // lets the person reading this tell which of those happened.
  say(`Stored in ${outcome.where}.`);
  if (!outcome.secured) {
    say();
    say("That file is NOT encrypted. Anyone who can read your files can read the token.");
    say("Consider setting WEEEK_API_TOKEN in the server's environment instead.");
  }
  say("The server finds it there by itself. WEEEK_API_TOKEN, if set, still wins over it.");
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
