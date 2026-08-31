import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where the token lives when it is not in the environment.
 *
 * This is the whole of the secret layer: the server reads through it at startup only when
 * WEEEK_API_TOKEN is unset, and `weeek-mcp init` writes through it. It sits beside config.ts rather
 * than under a `config/` directory, which would read as a sibling of that file and is not.
 *
 * The environment is not consulted here at all. Its priority is arranged by the caller, in
 * server.ts, which resolves a token into a copy of the environment *before* loadConfig sees it —
 * so "the environment wins" is true by construction rather than by a rule someone has to keep.
 */

/** Both halves of the key this server stores under, in one place because they must match. */
const SERVICE = "weeek-mcp";
const ACCOUNT = "api-token";

/** What a save did, in words the wizard prints verbatim. */
export type SaveOutcome = {
  /** Names the store. "the macOS Keychain", "a file at …" — never just "saved". */
  where: string;
  /**
   * False when the token ended up on disk in the clear. The wizard says so out loud: a fallback
   * nobody is told about is the same as a promise that was not kept.
   */
  secured: boolean;
};

/**
 * Whether the platform keychain can be trusted here, and what to call it.
 *
 * The Linux answer is the reason this is a function rather than a constant, and it is the one
 * decision in this file that has to be made **before** writing rather than checked after.
 * `@napi-rs/keyring` builds its Linux store as "Secret Service, or else kernel keyutils"
 * (`linux_credential_builder.rs` on v1.3.0). When the Secret Service is not there the write
 * succeeds into the session keyring — and reading it back **also succeeds**, in the same process,
 * for as long as that session lasts. The token then disappears at logout or reboot with nothing
 * having reported a problem. Verifying the write by reading it back, which is what catches every
 * other kind of silent failure, cannot see this one at all.
 *
 * So the store is chosen up front instead: no session bus, no keychain, write the file and say so.
 * A named fallback is worth more than a save that might evaporate.
 *
 * INFERRED, not verified — the Linux behaviour above is read out of the library's Rust source and
 * has not been run on a Linux machine, because there was none to run it on. The bus check is a
 * necessary condition rather than a sufficient one: a bus can be present while the service behind
 * it does not answer, and the library would fall through to keyutils again. That residue is why
 * {@link saveToken} names the store it used in its answer — the user reads where the token went
 * rather than the word "saved".
 *
 * `platform` and `env` are parameters rather than reads of `process`: an unrun branch of a
 * platform check is a claim, not a check, and this way secrets.test.ts drives every branch from
 * whichever machine it happens to be on.
 */
export function keychainChoice(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { usable: boolean; name: string; reason: string } {
  if (platform === "darwin") {
    return { usable: true, name: "the macOS Keychain", reason: "" };
  }
  if (platform === "win32") {
    return { usable: true, name: "the Windows Credential Manager", reason: "" };
  }

  // Linux, the BSDs and anything else the library reaches through D-Bus. The variable is how a
  // desktop session advertises the bus; without it there is nothing for the Secret Service to
  // answer on, and the library's fallback is the one that loses the token quietly.
  if (env["DBUS_SESSION_BUS_ADDRESS"]?.trim()) {
    return { usable: true, name: "the Secret Service", reason: "" };
  }

  return {
    usable: false,
    name: "",
    reason:
      "there is no session D-Bus here (DBUS_SESSION_BUS_ADDRESS is unset), so the system " +
      "keychain would fall through to the kernel session keyring, which loses the token at " +
      "logout",
  };
}

/**
 * Loads the native keychain library, or fails in our own words.
 *
 * Lazy on purpose, and the laziness is load-bearing twice over. A server that got its token from
 * the environment must never touch this: the module is a native binding, and a missing one would
 * otherwise kill a process that had everything it needed. And the committed plugin bundle ships as
 * a single file with no `node_modules` beside it, so for that build the import cannot resolve at
 * all — by design, since the plugin route carries the token through `userConfig` instead.
 *
 * Both failures are caught here and given a sentence somebody can act on. Left alone, the library's
 * own message reads "npm has a bug related to optional dependencies", which it says whatever the
 * cause — including on a platform it simply does not build for.
 */
async function loadKeyring(): Promise<typeof import("@napi-rs/keyring")> {
  try {
    return await import("@napi-rs/keyring");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    throw new Error(
      code === "ERR_MODULE_NOT_FOUND"
        ? "This build has no system keychain support: @napi-rs/keyring is not installed beside " +
          "it. The plugin bundle is deliberately built that way — it takes the token from " +
          "WEEEK_API_TOKEN, which the plugin fills in from its own settings. Set that variable, " +
          "or install this server from npm to use the keychain."
        : "The system keychain library will not load on this machine, most likely because there " +
          `is no prebuilt binding for ${process.platform}/${process.arch}. Set WEEEK_API_TOKEN ` +
          `in the environment instead. The library said: ${describeCause(error)}`,
    );
  }
}

/** The real reasons behind the library's misleading headline, which it hides in `error.cause`. */
function describeCause(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (Array.isArray(cause)) {
    return cause.map((entry) => (entry as Error | null)?.message ?? String(entry)).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The token this machine has stored, or null when it has none.
 *
 * Never throws for a reason the caller cannot fix. A keychain that will not open, a binding that
 * will not load, a file that is not there — all of them mean "no stored token" as far as startup is
 * concerned, and the server's own message about a missing token is the one worth showing. The
 * wizard, which *can* act on the difference, calls the pieces directly.
 */
export async function readStoredToken(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (keychainChoice(platform, env).usable) {
    try {
      const { AsyncEntry } = await loadKeyring();
      const stored = (await new AsyncEntry(SERVICE, ACCOUNT).getPassword())?.trim();
      if (stored) return stored;
    } catch {
      // Falls through to the file. A keychain that cannot be read is not evidence that the file
      // fallback is empty — on a machine where the wizard already chose the file, it is expected.
    }
  }

  return readTokenFile(platform, env);
}

/**
 * Puts the token somewhere it will still be after a reboot, and says where that was.
 *
 * The keychain write is verified by reading it back through a *fresh* entry, because a zero exit is
 * not proof: the case this guards is a store that accepts a write and keeps something else, or
 * nothing. What it cannot guard is the Linux keyutils substitution — see {@link keychainChoice},
 * which is why that decision is made before the write rather than after it.
 */
export async function saveToken(
  token: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SaveOutcome> {
  const choice = keychainChoice(platform, env);

  if (choice.usable) {
    try {
      const { AsyncEntry } = await loadKeyring();
      await new AsyncEntry(SERVICE, ACCOUNT).setPassword(token);

      // A new entry, not the one just written through: this has to read the store rather than
      // anything the library may be holding on to.
      const readBack = await new AsyncEntry(SERVICE, ACCOUNT).getPassword();
      if (readBack === token) return { where: choice.name, secured: true };

      throw new Error(
        `${choice.name} accepted the token and gave back ` +
          `${readBack === null ? "nothing" : "something else"}`,
      );
    } catch (error) {
      // Not fatal, and not silent either: the file is a real place to keep it, and the sentence
      // the wizard prints says both where the token went and why it went there.
      return writeTokenFile(token, platform, env, reasonOf(error));
    }
  }

  return writeTokenFile(token, platform, env, choice.reason);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where the fallback file lives, following each platform's own convention for such a thing. */
export function tokenFilePath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    const appData = env["APPDATA"]?.trim();
    return join(appData || join(homedir(), "AppData", "Roaming"), "weeek-mcp", "token.json");
  }

  const configHome = env["XDG_CONFIG_HOME"]?.trim();
  return join(configHome || join(homedir(), ".config"), "weeek-mcp", "token.json");
}

type TokenFile = { token: string; encryption: "none" | "dpapi" };

function readTokenFile(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  let parsed: TokenFile;
  try {
    parsed = JSON.parse(readFileSync(tokenFilePath(platform, env), "utf8")) as TokenFile;
  } catch {
    return null;
  }

  if (parsed.encryption === "dpapi") {
    try {
      return dpapiUnprotect(parsed.token).trim() || null;
    } catch {
      return null;
    }
  }

  return typeof parsed.token === "string" ? parsed.token.trim() || null : null;
}

/**
 * Writes the token to a file only its owner can read, and reports honestly what that is worth.
 *
 * On Windows `0600` buys nothing — the mode maps to the read-only attribute and sets no ACL — so
 * the bytes are wrapped with DPAPI first, through PowerShell's `ProtectedData`, which needs no
 * module installed. That wrapping is verified by unwrapping it again before this claims the file
 * is protected; if any part of it does not work, the token is still written and `secured` is false,
 * and the wizard says the file is not encrypted. Claiming protection that is not there is the one
 * outcome worth avoiding entirely.
 *
 * The plaintext reaches PowerShell through the environment, never through argv, because argv is
 * readable by other processes of the same user — the leak that made shelling out to `security` on
 * macOS the wrong choice in the first place.
 *
 * NOT VERIFIED ON WINDOWS. This was written and tested on macOS; the DPAPI branch has never been
 * executed. It is built so that failing is safe — a throw anywhere lands on the unprotected path,
 * which announces itself — rather than built on the assumption that it works.
 */
function writeTokenFile(
  token: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  reason: string,
): SaveOutcome {
  const path = tokenFilePath(platform, env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  let contents: TokenFile = { token, encryption: "none" };
  let secured = false;

  if (platform === "win32") {
    try {
      const wrapped = dpapiProtect(token);
      // Unwrapped again before it is believed. Half of a working round trip is not encryption.
      if (dpapiUnprotect(wrapped) === token) {
        contents = { token: wrapped, encryption: "dpapi" };
        secured = true;
      }
    } catch {
      // Left as it was: written in the clear, and said so below.
    }
  } else {
    // The mode is set on the open, not afterwards, so there is no window where the file exists
    // readable. chmod after the fact repeats it for a file that was already there from before.
    secured = true;
  }

  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  const because = reason === "" ? "" : `, because ${reason}`;
  return {
    where: secured
      ? `a file at ${path}, readable only by you${because}`
      : `a file at ${path} — IN PLAIN TEXT, because this machine's DPAPI wrapping did not work` +
        `${because === "" ? "" : because}`,
    secured,
  };
}

const DPAPI_PREAMBLE = "Add-Type -AssemblyName System.Security;";

function powershell(script: string, env: NodeJS.ProcessEnv): string {
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

function dpapiProtect(token: string): string {
  return powershell(
    `${DPAPI_PREAMBLE} ` +
      "$b=[System.Text.Encoding]::UTF8.GetBytes($env:WEEEK_DPAPI_IN); " +
      "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))",
    { WEEEK_DPAPI_IN: token },
  );
}

function dpapiUnprotect(wrapped: string): string {
  return powershell(
    `${DPAPI_PREAMBLE} ` +
      "$b=[Convert]::FromBase64String($env:WEEEK_DPAPI_IN); " +
      "[System.Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))",
    { WEEEK_DPAPI_IN: wrapped },
  );
}
