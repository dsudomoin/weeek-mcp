// What the Claude Code plugin ships, rather than what any one module does. It lives under src/
// because that is the only place `npm test` looks, and the things it checks — manifests that have
// to agree, and build artefacts that are committed — have no source file to sit beside.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PLUGIN_ROOT = "plugins/weeek";
/**
 * Two server declarations, one per client, and the split is deliberate rather than duplication.
 * Claude substitutes `${user_config.*}` into a plugin's env; Codex does not, and passes the text
 * through as it stands — so a shared file gives Codex a literal `${user_config.api_token}`, which
 * `loadConfig` accepts as a token and every call then answers 401 with the keychain never asked.
 */
const CLAUDE_SERVERS = `${PLUGIN_ROOT}/.mcp.json`;
const CODEX_SERVERS = `${PLUGIN_ROOT}/.codex-plugin/mcp.json`;
/** The one file `npm run build` generates that is committed, and the only one worth diffing. */
const NOTICES = "THIRD-PARTY-NOTICES.md";

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), "utf8")) as T;
}

function marketplaceEntry(): { name: string; version: string } {
  const marketplace = readJson<{ plugins: { name: string; version: string; source: string }[] }>(
    ".claude-plugin/marketplace.json",
  );

  const entry = marketplace.plugins.find((candidate) => candidate.source === `./${PLUGIN_ROOT}`);
  assert.ok(entry, `no marketplace entry has source "./${PLUGIN_ROOT}"`);
  return entry;
}

/** The npm spec one of those files launches, e.g. `@dsudomoin/weeek-mcp@0.2.0`. */
function launchedSpec(servers: string): string {
  const mcp = readJson<{ mcpServers: { weeek: { command: string; args: string[] } } }>(servers);

  assert.equal(mcp.mcpServers.weeek.command, "npx");
  const [flag, spec, ...rest] = mcp.mcpServers.weeek.args;
  assert.equal(flag, "-y", "npx must not stop to ask whether to install");
  assert.deepEqual(rest, [], "the server takes no arguments beyond the package spec");
  assert.ok(spec !== undefined, `${servers} declares the weeek server with no package to run`);
  return spec;
}

test("the marketplace entry and the plugin manifest name the same plugin", () => {
  // The source path is the only thing tying the two files together, and nothing re-checks it at
  // runtime: rename the directory or the plugin and the marketplace points at nothing. `claude
  // plugin validate` would catch it, but that is run by hand, which is the reason this file exists.
  const plugin = readJson<{ name: string }>(`${PLUGIN_ROOT}/.claude-plugin/plugin.json`);

  assert.equal(marketplaceEntry().name, plugin.name);
});

test("the version in the README's Codex example is the version being published", () => {
  // The sixth place, and the only one outside a manifest: a reader copies that stanza verbatim, so
  // a stale version here installs an old server for anyone who follows the README rather than the
  // plugin. Nothing else checks it — the five manifest copies are machine-read, this one is prose.
  const pkg = readJson<{ name: string; version: string }>("package.json");
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

  const specs = [...readme.matchAll(/@dsudomoin\/weeek-mcp@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);

  assert.notEqual(specs.length, 0, "the README no longer pins a version anywhere");
  for (const found of specs) {
    assert.equal(found, pkg.version, `the README still says ${pkg.name}@${found}`);
  }
});

test("no userConfig option is required, because a missing one registers no server at all", () => {
  // Not a style preference. Claude registers the plugin's MCP server only once every *required*
  // option has a value, and an unset one produces no server, no tools and no error anywhere — a
  // plugin that lists as installed and enabled and does nothing. Both options here have a second
  // route (`weeek-mcp init` for the token, refusal-by-default for the attachment directory), so
  // the server can always start and say what it is missing, which it cannot do if it never runs.
  const manifest = readJson<{ userConfig: Record<string, { required?: boolean }> }>(
    `${PLUGIN_ROOT}/.claude-plugin/plugin.json`,
  );

  const required = Object.entries(manifest.userConfig)
    .filter(([, option]) => option.required === true)
    .map(([name]) => name);

  assert.deepEqual(required, [], `these would stop the server being registered: ${required.join(", ")}`);
});

test("every user_config reference in .mcp.json names an option the manifest declares", () => {
  // Claude does not ignore a reference to an option that is not declared: the substitution throws
  // ("Plugin option X isn't set"), and the server never registers. A declared option that is simply
  // unset is the safe case — it resolves to the empty string, which this server reads as absent —
  // so the whole hazard is a name that does not match, which nothing else here would catch.
  const manifest = readJson<{ userConfig: Record<string, unknown> }>(
    `${PLUGIN_ROOT}/.claude-plugin/plugin.json`,
  );
  const mcp = readFileSync(join(REPO_ROOT, PLUGIN_ROOT, ".mcp.json"), "utf8");

  for (const [, option] of mcp.matchAll(/\$\{user_config\.([^}]+)\}/g)) {
    assert.ok(option !== undefined && option in manifest.userConfig, `no such option: ${option}`);
  }
});

test("the release version is one value, in all six places that carry it", () => {
  // Six, since Codex needed a server file of its own. Two of them are the ones that bite: each
  // plugin launches an exact version through npx, so a package published as 0.2.0 while a server
  // file still says 0.1.0 installs the old server for every user of that client, silently and
  // forever. Claude also only offers an update when the plugin's own version moves, so a
  // package.json bumped alone reaches nobody who already installed it.
  const pkg = readJson<{ name: string; version: string }>("package.json");
  const claude = readJson<{ version: string }>(`${PLUGIN_ROOT}/.claude-plugin/plugin.json`);
  const codex = readJson<{ version: string }>(`${PLUGIN_ROOT}/.codex-plugin/plugin.json`);

  assert.equal(claude.version, pkg.version, "the Claude plugin manifest is out of step");
  assert.equal(codex.version, pkg.version, "the Codex plugin manifest is out of step");
  assert.equal(marketplaceEntry().version, pkg.version, "the marketplace entry is out of step");
  for (const servers of [CLAUDE_SERVERS, CODEX_SERVERS]) {
    assert.equal(launchedSpec(servers), `${pkg.name}@${pkg.version}`, `${servers} is out of step`);
  }
});

test("each plugin launches the published package by an exact version, not a range", () => {
  // A range costs a round trip to the registry on every single server start — measured at 280 to
  // 520 ms — because npx has to fetch the packument to learn what it resolves to. It also takes
  // away the user's ability to stay on a version that works when a new one does not.
  for (const servers of [CLAUDE_SERVERS, CODEX_SERVERS]) {
    const spec = launchedSpec(servers);
    const at = spec.lastIndexOf("@");

    assert.ok(at > 0, `${spec} names no version`);
    assert.match(spec.slice(at + 1), /^\d+\.\d+\.\d+$/, `${spec} is not an exact version`);
  }
});

test("the Codex server file carries no user_config placeholder, because Codex has no such thing", () => {
  // The defect this file exists to prevent, and it was measured rather than reasoned: with the
  // shared file, `codex mcp get weeek --json` after `codex plugin add` reported
  // WEEEK_API_TOKEN="${user_config.api_token}" verbatim. That is a *non-empty* string, so
  // loadConfig takes it for a token, never asks the keychain, and every call comes back 401 —
  // a server that looks alive and fails on first use, which is worse than refusing to start.
  // The Codex manifest points here rather than at the shared file precisely so this stays true.
  const codexPlugin = readJson<{ mcpServers: string }>(`${PLUGIN_ROOT}/.codex-plugin/plugin.json`);
  assert.equal(codexPlugin.mcpServers, `./${CODEX_SERVERS.slice(PLUGIN_ROOT.length + 1)}`);

  const servers = readFileSync(join(REPO_ROOT, CODEX_SERVERS), "utf8");
  assert.doesNotMatch(servers, /\$\{/, "Codex substitutes nothing: this would be passed through");
  // And with no token in that environment at all, the keychain is what answers — the only route
  // Codex has, since a Codex plugin cannot ask its user for anything.
  assert.doesNotMatch(servers, /WEEEK_API_TOKEN/);
});

test("a registry that cannot be reached fails in a second rather than in seventy", () => {
  // Measured: with npm's defaults, an unreachable registry leaves npx hanging for 70.2 seconds and
  // then failing, which blows through every client's startup timeout and takes the whole session's
  // patience with it. With retries off it is 194 ms and an error the user can read. This is the
  // one setting standing between "no network" and "the client hangs".
  for (const servers of [CLAUDE_SERVERS, CODEX_SERVERS]) {
    const mcp = readJson<{ mcpServers: { weeek: { env: Record<string, string> } } }>(servers);

    assert.equal(mcp.mcpServers.weeek.env["npm_config_fetch_retries"], "0", `${servers} hangs`);
  }
});

test("the package publishes the licence texts for the code it redistributes", () => {
  // Bundling makes the tarball a redistributor. Twelve packages' compiled code sits inside
  // dist/server.mjs — three of them under BSD or ISC rather than MIT — and every one of those
  // licences requires the notice to travel with the copy. Publishing tsc output instead would have
  // removed the obligation, because npm would copy each dependency itself; it would also have cost
  // 105 packages and 35 MB on every cold start, which is why we are a redistributor on purpose.
  const pkg = readJson<{ files: string[] }>("package.json");

  for (const file of ["LICENSE", NOTICES]) {
    assert.ok(existsSync(join(REPO_ROOT, file)), `${file} is missing from the repository root`);
    assert.ok(pkg.files.includes(file), `${file} is not in the published files list`);
  }
});

test("the published entry point is the file the build actually writes", () => {
  // `bin` is what npm symlinks into PATH and what npx executes. Point it at a path the build does
  // not produce and the failure is npm's spawn, not ours: no message, no server, nothing to read.
  const pkg = readJson<{ bin: Record<string, string>; files: string[] }>("package.json");
  const entry = pkg.bin["weeek-mcp"];

  assert.ok(entry !== undefined, "the package declares no weeek-mcp binary");
  assert.ok(pkg.files.some((pattern) => entry.startsWith(pattern)), `${entry} is not published`);
  assert.ok(existsSync(join(REPO_ROOT, entry)), `${entry} does not exist — run \`npm run build\``);
});

test("the committed notices are what the current sources build", () => {
  // The one real hazard of checking a generated artefact in: it drifts the moment someone adds or
  // updates a dependency and forgets to rebuild, and nothing about the repository looks wrong
  // afterwards. The file is published, so a stale one is a licence obligation quietly unmet.
  const scratch = mkdtempSync(join(tmpdir(), "weeek-bundle-"));

  try {
    execFileSync(process.execPath, [join(REPO_ROOT, "scripts/bundle.mjs"), scratch], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });

    assert.ok(
      readFileSync(join(REPO_ROOT, NOTICES)).equals(readFileSync(join(scratch, NOTICES))),
      `${NOTICES} is stale: run \`npm run build\` and commit the result`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("both marketplaces point at the same plugin directory", () => {
  // Two catalogues, one plugin, and nothing at build time reads them together. Codex spells the
  // source as an object where Claude spells it as a string, so the two cannot be compared by shape
  // — only by where they end up pointing.
  const codex = readJson<{
    plugins: { name: string; source: { source: string; path: string } }[];
  }>(".agents/plugins/marketplace.json");

  const entry = codex.plugins.find((candidate) => candidate.name === "weeek");
  assert.ok(entry, "the Codex marketplace lists no weeek plugin");
  assert.equal(entry.source.path, `./${PLUGIN_ROOT}`);
  assert.equal(entry.source.source, "local");
});

test("the Codex manifest carries the interface block Codex refuses to load without", () => {
  // Codex validates this and rejects unknown keys outright, so a field invented here fails the
  // whole plugin rather than being ignored. These seven are the ones its validator requires.
  const codex = readJson<{ interface: Record<string, unknown> }>(
    `${PLUGIN_ROOT}/.codex-plugin/plugin.json`,
  );

  for (const field of [
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
    "capabilities",
    "defaultPrompt",
  ]) {
    assert.ok(codex.interface[field] !== undefined, `interface.${field} is missing`);
  }
});

test("the setup command the plugin advertises is actually in the plugin", () => {
  // A slash command is a file and nothing at build time looks for it: rename or move it and the
  // plugin still installs, still lists, and simply has no /weeek-setup. That matters more than a
  // missing file usually would, because the command is the only thing standing between a user and
  // an assistant that decides to ask for the token itself.
  const command = join(REPO_ROOT, PLUGIN_ROOT, "commands", "weeek-setup.md");
  assert.ok(existsSync(command), "plugins/weeek/commands/weeek-setup.md is missing");

  const text = readFileSync(command, "utf8");
  assert.match(text, /weeek-mcp init/);
  // The instruction that makes the wizard's refusal meaningful rather than an obstacle.
  assert.match(text, /[Dd]o not ask the user for their token/);
});

test("the smoke script and npm point at the same built server", () => {
  // Caught by breaking it: renaming the build's output to dist/server.mjs left
  // scripts/live-smoke.mjs pointing at dist/server.js, and nothing said so — `npm test` never runs
  // that script, by design, so it stayed broken until someone reached for it. It is the tool you
  // use to check a release against a real workspace, which is exactly when a stale path costs most.
  const pkg = readJson<{ bin: Record<string, string> }>("package.json");
  const entry = pkg.bin["weeek-mcp"];
  assert.ok(entry !== undefined);

  const smoke = readFileSync(join(REPO_ROOT, "scripts/live-smoke.mjs"), "utf8");
  const referenced = /new URL\("\.\.\/([^"]+)"/.exec(smoke);

  assert.ok(referenced?.[1] !== undefined, "live-smoke.mjs names no server to run");
  assert.equal(referenced[1], entry, "live-smoke.mjs runs a different file than npm publishes");
});
