import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { ConfigError } from "../config.ts";
import { WeeekClient } from "../http/client.ts";
import { WeeekApiError, describeApiError, asRecord } from "../http/quirks.ts";
import { readStoredToken, saveToken } from "../secrets.ts";
import { OPS } from "../weeek/operations.ts";
import { type Client, type Host, applyFileRoot, defaultHost, detectClients } from "./clients.ts";
import { interpretRoot } from "./file-root.ts";

/**
 * `weeek-mcp init` — the wizard that sets up the two things nobody should have to put in a
 * configuration file by hand: the token, and the one directory the attachment tools may touch.
 *
 * Three decisions shape all of it.
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
 *
 * **The two halves are stored in opposite places, and that asymmetry is the design.** The token
 * goes into this machine's keychain, which the server reads for itself. The directory goes into the
 * *client's* configuration, which the server cannot read at all and only ever receives through the
 * environment it is launched with. There is no weeek-mcp settings file and there must not be one:
 * a boundary the server can read is a boundary a model can talk it into re-reading, and the model
 * spends its day reading comments that other people wrote.
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
 * Reads an ordinary, echoed line.
 *
 * A fresh interface per question rather than one held open across the wizard: readline puts a
 * terminal into raw mode and takes over echoing while it lives, and the token prompt above does its
 * own raw-mode handling. Two owners of one terminal is a bug waiting for the first person who
 * presses an arrow key, and closing after each answer means there is only ever one.
 */
async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
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
  // First, before anything is read. The wizard asks several questions now, so needing a terminal
  // is a property of the whole of it rather than of the token prompt — and this order is what
  // keeps a run that is going to be refused from touching the keychain on its way to the refusal.
  requireTerminal();

  say("weeek-mcp setup");
  say();

  await configureToken();
  await configureFileRoot();

  say();
  say("Restart your client, or reconnect the server inside it, before using any of this. Both the");
  say("token and the directory are read once, when the server starts, so a client that is already");
  say("running has neither.");
}

/**
 * The token half.
 *
 * An already-stored token can be kept with Enter, and that is not politeness. The directory half
 * below is the reason this wizard gets run a second and third time — a directory is something
 * people change their mind about — and a setup step that demanded the token again every time would
 * push somebody towards keeping it somewhere easier to copy from.
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
  say("The server finds it there by itself. WEEEK_API_TOKEN, if set, still wins over it.");
}

/**
 * The attachment-directory half.
 *
 * Written into whichever clients on this machine launch this server, and into nothing of ours —
 * see the note at the top of this file and the longer one in clients.ts. Every client is offered
 * the same directory: somebody who uses Claude Code and Codex both needs it in both, and setting
 * one silently would leave the other refusing every path with nothing to explain why.
 */
async function configureFileRoot(): Promise<void> {
  const host = defaultHost();
  const clients = detectClients(host);

  say();
  say("Attachments");
  say();
  say("Two of the tools reach your disk: one saves a downloaded attachment, one uploads a local");
  say("file. Both take the path from the model, which has just been reading task descriptions and");
  say("comments that other people wrote — so one directory is the whole boundary. Name one that");
  say("holds nothing private and that nothing is executed from.");
  say();

  if (clients.length === 0) {
    say("Nothing on this machine is set up to launch this server yet, so there is no client");
    say("configuration to write the directory into. Add the server to Claude Code or to Codex —");
    say("the README has both — and run this again. Until then both file tools refuse every path.");
    return;
  }

  for (const client of clients) {
    say(
      client.currentRoot === null
        ? `${client.label}: no directory, so both file tools refuse every path.`
        : `${client.label}: ${client.currentRoot}`,
    );
  }
  say();

  const root = await askForRoot(
    sharedRoot(clients),
    clients.some((client) => client.currentRoot !== null),
  );
  if (root === null) return;

  for (const client of clients) {
    say();
    report(host, client, root);
  }
}

/**
 * The directory to offer back, or null when there is nothing to keep.
 *
 * Only when every client agrees. Two clients pointing at different directories is a state this
 * wizard did not create and should not resolve by picking one behind a default — it lists both
 * above and asks outright.
 */
function sharedRoot(clients: Client[]): string | null {
  const first = clients[0]?.currentRoot ?? null;
  return clients.every((client) => client.currentRoot === first) ? first : null;
}

/**
 * The directory to write everywhere: "" to clear it, or null to change nothing at all.
 *
 * `current` is the directory every client agrees on, and `anySet` is whether any of them has one at
 * all — which is not the same question and is why both are here. Two clients pointing at different
 * directories leaves nothing to offer back, but Enter there must still mean "change nothing", and
 * saying "left unset, both tools refuse every path" would be a plain untruth about a machine where
 * they do not.
 */
async function askForRoot(current: string | null, anySet: boolean): Promise<string | null> {
  for (;;) {
    const typed = (
      await readLine(
        current !== null
          ? `Directory [${current}], Enter to keep it, "none" to clear it: `
          : anySet
            ? 'Directory, Enter to change nothing, "none" to clear them all: '
            : "Directory, or Enter to leave both tools refused: ",
      )
    ).trim();

    if (typed === "") {
      if (current !== null || anySet) return null;
      say();
      say("Left unset. Both file tools will refuse every path and say so when they are asked.");
      return null;
    }
    if (typed.toLowerCase() === "none") return "";

    let attempt = interpretRoot(typed);

    if (attempt.kind === "absent") {
      const answer = await readLine(`${attempt.path} does not exist. Create it? [y/N] `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        say();
        continue;
      }
      try {
        mkdirSync(attempt.path, { recursive: true });
      } catch (error) {
        say(`Could not create it: ${reasonOf(error)}`);
        say();
        continue;
      }
      attempt = interpretRoot(typed);
    }

    if (attempt.kind === "ok") {
      // Printed, not refused: the boundary is the operator's to draw, and this is only so that it
      // is a boundary they know they drew. The server says the same thing at every start.
      if (attempt.warning !== null) {
        say();
        say(attempt.warning);
      }
      return attempt.path;
    }

    say();
    say(attempt.kind === "refused" ? attempt.why : `${typed} could not be used as a directory.`);
    say();
  }
}

/** Sets the directory in one client and says exactly what happened, including when nothing did. */
function report(host: Host, client: Client, root: string): void {
  const applied = applyFileRoot(host, client, root);
  const named = root === "" ? "no directory — both file tools refuse every path" : root;

  switch (applied.kind) {
    case "unchanged":
      say(`${client.label}: already ${named}.`);
      return;
    case "written":
      say(`${client.label}: ${named}.`);
      say(`  The file as it was is kept at ${applied.backup}.`);
      return;
    case "manual":
      // The reason on its own line rather than trailing the label: these are whole sentences, and
      // a wizard whose failures are harder to read than its successes is one people stop reading.
      say(`${client.label}: NOT changed.`);
      say(`  ${applied.why}.`);
      for (const step of applied.steps) {
        say();
        say(`    ${step}`);
      }
      if (applied.note !== null) {
        say();
        say(`  ${applied.note}`);
      }
      return;
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
