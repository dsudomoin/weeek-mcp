import { ConfigError } from "../config.ts";
import { WeeekClient } from "../http/client.ts";
import { WeeekApiError, describeApiError, asRecord } from "../http/quirks.ts";
import { saveToken } from "../secrets.ts";
import { OPS } from "../weeek/operations.ts";

/**
 * `weeek-mcp init` — the wizard that puts a token on this machine without it passing through
 * anybody's shell history, a configuration file, or a model's transcript.
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
async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    throw new ConfigError(
      "weeek-mcp init needs a terminal: it reads the token without echoing it, and it cannot do " +
        "that when its input is a pipe or a file. Run it yourself in a terminal. If you are " +
        "automating a setup, set WEEEK_API_TOKEN in the server's environment instead — that path " +
        "takes priority over anything stored here and needs no wizard.",
    );
  }

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

/** The name Weeek answers with, so the wizard can say who was authenticated rather than "ok". */
function nameFromProfile(payload: unknown): string | null {
  const user = asRecord(asRecord(payload)?.["user"]);
  const parts = [user?.["firstName"], user?.["lastName"]].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return parts.length === 0 ? null : parts.join(" ");
}

export async function runInit(): Promise<void> {
  say("weeek-mcp setup");
  say();
  say("Create a token in Weeek under Settings -> API, then paste it below.");
  say("It is not shown as you type, and it is not stored until Weeek accepts it.");
  say();

  const token = (await readSecret("Weeek API token: ")).trim();
  if (token === "") throw new ConfigError("No token was entered. Nothing was stored.");

  say("Checking it with Weeek...");

  // The token is checked before it is kept, and this is the only request the wizard makes. GET,
  // and the cheapest one there is: it proves the token works and says whose it is.
  let profile: unknown;
  try {
    profile = await new WeeekClient({
      token,
      baseUrl: "https://api.weeek.net/public/v1",
      timeoutMs: 30_000,
    }).request(OPS.getProfile);
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

  const who = nameFromProfile(profile);
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
  say();
  say("The server will use it automatically. WEEEK_API_TOKEN, if set, still wins over this.");
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
