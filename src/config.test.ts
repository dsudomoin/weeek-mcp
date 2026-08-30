import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posix, win32 } from "node:path";
import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import {
  ConfigError,
  assertSupportedNode,
  fileRootWarning,
  isFilesystemRoot,
  loadConfig,
} from "./config.ts";

test("reads the token from the environment and applies defaults", () => {
  const config = loadConfig({ WEEEK_API_TOKEN: "secret" });
  assert.equal(config.token, "secret");
  assert.equal(config.baseUrl, "https://api.weeek.net/public/v1");
  assert.equal(config.timeoutMs, 30_000);
});

test("fails with a clear message when the token is missing", () => {
  // The type matters as much as the message: server.ts reports a ConfigError as one sentence and
  // anything else in full, so a plain Error here would reach the user as a stack trace.
  assert.throws(
    () => loadConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /WEEEK_API_TOKEN is not set/);
      return true;
    },
  );
});

test("trims whitespace around the token", () => {
  assert.equal(loadConfig({ WEEEK_API_TOKEN: "  secret\n" }).token, "secret");
  assert.throws(() => loadConfig({ WEEEK_API_TOKEN: "   " }), /WEEEK_API_TOKEN/);
});

test("strips trailing slashes from baseUrl", () => {
  const config = loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_BASE_URL: "https://example.com/v1///" });
  assert.equal(config.baseUrl, "https://example.com/v1");
});

test("falls back to the default baseUrl when the variable is empty", () => {
  const config = loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_BASE_URL: "" });
  assert.equal(config.baseUrl, "https://api.weeek.net/public/v1");
});

test("falls back to the default baseUrl when the variable is only whitespace", () => {
  const config = loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_BASE_URL: "   " });
  assert.equal(config.baseUrl, "https://api.weeek.net/public/v1");
});

test("ignores a garbage timeout", () => {
  const config = loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_TIMEOUT_MS: "-5" });
  assert.equal(config.timeoutMs, 30_000);
});

test("reads a positive timeout", () => {
  const config = loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_TIMEOUT_MS: "5000" });
  assert.equal(config.timeoutMs, 5_000);
});

test("accepts the Node versions the server is declared to run on", () => {
  // The prerelease is not a curiosity: process.versions.node reads "26.0.0-nightly2026…" on a
  // nightly, and a comparison that choked on the suffix would refuse a Node newer than any asked
  // for here.
  for (const version of ["22.18.0", "22.19.1", "23.0.0", "25.6.1", "26.0.0-nightly20260101"]) {
    assert.doesNotThrow(() => assertSupportedNode(version), `${version} should be accepted`);
  }
});

test("a version string it cannot read is let through, not refused", () => {
  // Which way to fail matters more than it looks. A string this pattern cannot read is far likelier
  // to be some future shape than an old version, and refusing to start over our own parse would
  // strand somebody on a Node that would have run this perfectly well.
  for (const version of ["25", "", "not-a-version"]) {
    assert.doesNotThrow(() => assertSupportedNode(version), `"${version}" should be let through`);
  }
});

test("refuses an older Node with a message, not a stack", () => {
  // ConfigError, not Error, for the same reason the missing token is one: server.ts prints a
  // ConfigError as a single sentence and everything else with its stack, and a user whose Node is
  // three years old is served by the sentence.
  assert.throws(
    () => assertSupportedNode("20.11.1"),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /Node 22\.18 or newer, and this is Node 20\.11\.1/);
      return true;
    },
  );

  for (const version of ["18.20.4", "22.0.0", "22.17.9"]) {
    assert.throws(() => assertSupportedNode(version), ConfigError, `${version} should be refused`);
  }
});

test("the floor it refuses below is the floor package.json declares", () => {
  // Two independent statements of one number: the constant in config.ts and `engines`. Nothing
  // reads one from the other — the bundle ships without a package.json to read — so this is what
  // keeps them from drifting, in the direction that matters. A floor raised in the manifest alone
  // would promise npm a version the server still lets in.
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { engines: { node: string } };

  const declared = /^>=(\d+)\.(\d+)$/.exec(manifest.engines.node);
  assert.ok(declared, `engines.node is "${manifest.engines.node}", which this test cannot read`);

  const [, major = "0", minor = "0"] = declared;
  const below =
    Number(minor) > 0 ? `${major}.${Number(minor) - 1}.99` : `${Number(major) - 1}.99.99`;

  assert.doesNotThrow(() => assertSupportedNode(`${major}.${minor}.0`));
  assert.throws(() => assertSupportedNode(below), ConfigError);
});

// --- WEEEK_FILE_ROOT -----------------------------------------------------------------------

async function directory(t: TestContext): Promise<string> {
  // Resolved, because that is what loadConfig stores and what containment is compared against.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "weeek-root-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("no file root is named unless the operator names one", () => {
  // The default is nothing, and nothing means the two path-taking tools refuse. There is no
  // cwd-derived default because cwd is not the operator's choice: measured on this machine, an
  // MCP server under Claude Code inherits whichever directory `claude` was started in — $HOME in
  // two of three live sessions — and one launched by Codex inherits `/`. A boundary drawn there
  // would be drawn by accident, and in the common case would be no boundary at all.
  assert.equal(loadConfig({ WEEEK_API_TOKEN: "t" }).fileRoot, null);
  assert.equal(loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_FILE_ROOT: "" }).fileRoot, null);
  assert.equal(loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_FILE_ROOT: "   " }).fileRoot, null);
});

test("a named file root is resolved to a real absolute path", async (t) => {
  const dir = await directory(t);
  const link = join(dir, "shortcut");
  const real = join(dir, "real");
  await mkdir(real);
  await symlink(real, link);

  assert.equal(loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_FILE_ROOT: real }).fileRoot, real);
  // Through realpath, so that every later comparison is real path against real path. Stored
  // unresolved, a symlink above the root would turn containment into a string game.
  assert.equal(loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_FILE_ROOT: link }).fileRoot, real);
});

test("a file root that is set and unusable stops the server rather than being ignored", async (t) => {
  const dir = await directory(t);
  const file = join(dir, "a-file");
  await writeFile(file, "x");

  // Set-and-wrong is different from unset: the operator asked for a boundary and did not get one,
  // and carrying on would leave them believing it exists. Unset is the documented default and
  // throws nothing.
  for (const value of [join(dir, "nope"), file]) {
    assert.throws(
      () => loadConfig({ WEEEK_API_TOKEN: "t", WEEEK_FILE_ROOT: value }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /WEEEK_FILE_ROOT/);
        return true;
      },
      value,
    );
  }
});

test("a home directory as the root is honoured, and said out loud", async (t) => {
  const home = await directory(t);
  const env = { WEEEK_API_TOKEN: "t", HOME: home, WEEEK_FILE_ROOT: home };

  // Honoured, because the rule is that the operator declares the boundary — refusing what they
  // declared would be a different rule, and a blacklist would mislead anyway: ~/IdeaProjects holds
  // every project's .env and passes any such check cleanly.
  const config = loadConfig(env);
  assert.equal(config.fileRoot, home);

  const warning = fileRootWarning(config.fileRoot, env);
  assert.ok(warning !== null, "a home directory root should be warned about");
  // Names what came into scope, and says whose decision it was.
  assert.match(warning, /WEEEK_FILE_ROOT/);
  assert.match(warning, /\.ssh/);
  assert.match(warning, /configuration says rather than a fault/);
});

test("the root predicate is the same one on Windows, checked with path.win32", () => {
  // path.win32 behaves identically whichever OS runs it, so both platforms are testable from
  // either. Which matters here: the check this replaces compared against `sep`, and that is only
  // true on POSIX — C:\ and a UNC share root are roots no separator equals, so on Windows they
  // slipped through and hit exactly the doubling the check exists to prevent. Not a hole (nothing
  // is under "C:\\", so both tools failed shut) but the same defect N2 closed, alive elsewhere.
  // The shipped predicate, driven through both flavours — not a copy of it, or reverting the
  // production line to a POSIX-only comparison would leave this green.
  const isRoot = (p: typeof win32 | typeof posix, value: string): boolean =>
    isFilesystemRoot(p.resolve(value), p);

  for (const value of ["/", "\\", "C:\\", "\\\\srv\\share\\"]) {
    assert.equal(isRoot(win32, value), true, value);
  }
  for (const value of ["C:\\proj", "\\\\srv\\share\\proj", "C:\\proj\\sub"]) {
    assert.equal(isRoot(win32, value), false, value);
  }

  assert.equal(isRoot(posix, "/"), true);
  assert.equal(isRoot(posix, "/tmp"), false);

  // And the shape that made the old check wrong: a root already ends in a separator, so appending
  // one leaves nothing underneath it.
  assert.equal(win32.resolve("C:\\") + win32.sep, "C:\\\\");
  assert.equal(posix.resolve("/") + posix.sep, "//");
});

test("a filesystem root is refused, because it is almost never a decision", async (t) => {
  const home = await directory(t);

  // The exception to honouring what the operator wrote, and not on the grounds of danger: `/` is
  // what WEEEK_FILE_ROOT="$UNSET_VAR/" collapses to, so refusing it catches an accident rather
  // than overruling a choice. It is also the one value containment cannot express — "/" plus a
  // separator is "//", which nothing is under — so honouring it would silently disable both tools
  // while the warning said the opposite.
  assert.throws(
    () => loadConfig({ WEEEK_API_TOKEN: "t", HOME: home, WEEEK_FILE_ROOT: "/" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /did not expand/);
      // Says what it caught, since the same refusal now covers C:\ and a share root.
      assert.match(error.message, /filesystem root/);
      return true;
    },
  );

  // The spellings that reach the same place are refused with it, since the value is resolved
  // before anything looks at it.
  for (const value of ["//", "/.", "/usr/.."]) {
    assert.throws(
      () => loadConfig({ WEEEK_API_TOKEN: "t", HOME: home, WEEEK_FILE_ROOT: value }),
      ConfigError,
      value,
    );
  }
});

test("an ordinary root is not warned about, and neither is having none", async (t) => {
  const home = await directory(t);
  const inside = join(home, "projects");
  await mkdir(inside);
  const env = { WEEEK_API_TOKEN: "t", HOME: home, WEEEK_FILE_ROOT: inside };

  // A directory inside $HOME is an ordinary answer — it is $HOME itself that stops being a
  // boundary. Warning about every root would train the reader to skip the one that matters.
  assert.equal(loadConfig(env).fileRoot, inside);
  assert.equal(fileRootWarning(inside, env), null);
  assert.equal(fileRootWarning(null, env), null);
});

test("a home directory root is recognised on Windows too", async (t) => {
  const home = await directory(t);

  // Windows sets USERPROFILE and usually not HOME. Read only HOME, and the one warning that
  // exists for the widest configuration could never fire on that platform at all.
  const warning = fileRootWarning(home, { USERPROFILE: home });
  assert.ok(warning !== null);
  assert.match(warning, /home directory/);

  // HOME still wins where both are set, which is what a POSIX shell means by it.
  const elsewhere = await directory(t);
  assert.ok(fileRootWarning(home, { HOME: home, USERPROFILE: elsewhere }) !== null);
  assert.equal(fileRootWarning(home, { HOME: elsewhere, USERPROFILE: home }), null);
});
