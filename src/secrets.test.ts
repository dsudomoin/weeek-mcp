import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { keychainChoice, readStoredToken, saveToken, tokenFilePath } from "./secrets.ts";

/** The one platform-and-environment pair that reaches the file on any machine, keychain untouched. */
const FILE_ONLY = "linux";

/**
 * A config home of its own, so nothing here can read or write the real one.
 *
 * The assertion is a guard rather than decoration, and it is here because it was needed: what keeps
 * every write below out of the developer's own login keychain is `keychainChoice` answering "not
 * usable" for this pair. Break that function and the tests do not merely fail — they first store
 * their fixtures in a real keychain and leave them there. Checking the precondition converts that
 * into a loud failure before anything is written. Found by mutating the D-Bus check away and
 * watching test tokens land in a real Keychain.
 */
function scratchEnv(): NodeJS.ProcessEnv {
  assert.equal(
    keychainChoice(FILE_ONLY, {}).usable,
    false,
    "these tests would write to the real system keychain — refusing to run",
  );
  return { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "weeek-secrets-")) };
}

test("macOS and Windows use the platform keychain and name it", () => {
  // The name is asserted because it is not decoration: saveToken puts it in the sentence the
  // wizard prints, and "saved" without a place is the ambiguity this whole design removes.
  assert.deepEqual(keychainChoice("darwin", {}), {
    usable: true,
    name: "the macOS Keychain",
    reason: "",
  });
  assert.equal(keychainChoice("win32", {}).name, "the Windows Credential Manager");
});

test("Linux without a session bus refuses the keychain before writing to it", () => {
  // The decision this file exists to make. @napi-rs/keyring answers a missing Secret Service by
  // writing to the kernel session keyring, where the write succeeds, the read-back succeeds, and
  // the token is gone after a reboot — so verifying the write cannot catch it and the store has to
  // be chosen up front instead.
  const choice = keychainChoice("linux", {});

  assert.equal(choice.usable, false);
  assert.match(choice.reason, /DBUS_SESSION_BUS_ADDRESS/);
  assert.match(choice.reason, /session keyring/);
});

test("Linux with a session bus uses the Secret Service", () => {
  assert.deepEqual(keychainChoice("linux", { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/bus" }), {
    usable: true,
    name: "the Secret Service",
    reason: "",
  });
});

test("a bus address of only whitespace is not a bus address", () => {
  assert.equal(keychainChoice("linux", { DBUS_SESSION_BUS_ADDRESS: "   " }).usable, false);
});

test("an unknown platform is held to the same rule as Linux, not assumed to work", () => {
  // FreeBSD reaches the same D-Bus store in the library, and anything newer is safer refused than
  // trusted: the failure mode being guarded is silent loss, not inconvenience.
  assert.equal(keychainChoice("freebsd", {}).usable, false);
  assert.equal(keychainChoice("freebsd", { DBUS_SESSION_BUS_ADDRESS: "unix:x" }).usable, true);
});

test("the fallback file follows each platform's own convention", () => {
  assert.equal(
    tokenFilePath("linux", { XDG_CONFIG_HOME: "/tmp/cfg" }),
    join("/tmp/cfg", "weeek-mcp", "token.json"),
  );
  assert.equal(
    tokenFilePath("win32", { APPDATA: "C:\\Users\\x\\AppData\\Roaming" }),
    join("C:\\Users\\x\\AppData\\Roaming", "weeek-mcp", "token.json"),
  );
});

test("the file fallback is written 0600, read back, and says where it went and why", async () => {
  const env = scratchEnv();
  try {
    const outcome = await saveToken("A-TOKEN", FILE_ONLY, env);

    assert.equal(outcome.secured, true);
    assert.match(outcome.where, /token\.json/);
    // The reason travels with the place. A fallback the user is not told about is the same as a
    // promise that was quietly not kept.
    assert.match(outcome.where, /DBUS_SESSION_BUS_ADDRESS/);

    const path = tokenFilePath(FILE_ONLY, env);
    // 0o777 masks off the file-type bits; what is left is the permission triple, and it has to be
    // owner-only. A token readable by the group is the thing this mode exists to prevent.
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(await readStoredToken(FILE_ONLY, env), "A-TOKEN");
  } finally {
    rmSync(env["XDG_CONFIG_HOME"] as string, { recursive: true, force: true });
  }
});

test("no stored token anywhere reads as null rather than as a failure", async () => {
  const env = scratchEnv();
  try {
    // Startup takes this path on every machine that has never run the wizard, and it must not be
    // an error: the message worth showing there is the server's own, about the missing variable.
    assert.equal(await readStoredToken(FILE_ONLY, env), null);
  } finally {
    rmSync(env["XDG_CONFIG_HOME"] as string, { recursive: true, force: true });
  }
});

test("a damaged token file reads as null instead of throwing", async () => {
  const env = scratchEnv();
  try {
    await saveToken("A-TOKEN", FILE_ONLY, env);
    const path = tokenFilePath(FILE_ONLY, env);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, "{ this is not json");

    // A file half-written by a killed process must not stop a server that would otherwise take
    // its token from the environment on the very next line.
    assert.equal(await readStoredToken(FILE_ONLY, env), null);
  } finally {
    rmSync(env["XDG_CONFIG_HOME"] as string, { recursive: true, force: true });
  }
});

test("the stored file holds the token and its encryption state, not a bare string", async () => {
  const env = scratchEnv();
  try {
    await saveToken("A-TOKEN", FILE_ONLY, env);
    const written = JSON.parse(readFileSync(tokenFilePath(FILE_ONLY, env), "utf8")) as {
      token: string;
      encryption: string;
    };

    // The marker is what lets a Windows file written through DPAPI be told from one written in the
    // clear when it is read back, without guessing from the shape of the value.
    assert.deepEqual(written, { token: "A-TOKEN", encryption: "none" });
  } finally {
    rmSync(env["XDG_CONFIG_HOME"] as string, { recursive: true, force: true });
  }
});
