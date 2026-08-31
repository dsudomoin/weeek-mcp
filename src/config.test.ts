import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, assertSupportedNode, loadConfig } from "./config.ts";

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
