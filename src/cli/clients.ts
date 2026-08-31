import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { asRecord } from "../http/quirks.ts";

/**
 * The clients on this machine that launch this server, and how the attachment directory reaches
 * each one.
 *
 * The whole file exists to obey one rule, and it is worth stating before any of the mechanics. The
 * file root must arrive in the server's environment, put there by whoever launches it, and it must
 * not be stored anywhere the server itself reads. A boundary the server could read for itself is a
 * boundary the model can argue the server into re-reading; a boundary handed to it at launch by a
 * program it does not control is not. So `init` writes into the *client's* configuration and never
 * into its own — there is no weeek-mcp settings file, and adding one would undo the design.
 *
 * That is also why this reads as three special cases rather than one mechanism. Each client keeps
 * its registration in its own format, and none of the three is ours to write with our own code:
 *
 * - **Claude Code, plugin.** Values live in `~/.claude/settings.json` under `pluginConfigs`, and
 *   `.mcp.json` substitutes them into the environment. Written with `claude plugin install
 *   --config`, which merges into what is there rather than replacing it — verified, not assumed.
 * - **Claude Code, `claude mcp add`.** Never written. `claude mcp add` refuses outright when the
 *   name already exists ("MCP server weeek already exists in user config"), and the only way
 *   through is remove-then-add, which would discard any field of the stanza we failed to guess.
 *   The wizard prints the pair and lets the person decide.
 * - **Codex.** Written with `codex mcp add`, after reading the stanza back with `codex mcp get
 *   --json`. Node has no TOML parser, so a hand-rolled edit of `~/.codex/config.toml` would mean
 *   writing one — and a parser of ours that disagreed with Codex's, in either direction, would be
 *   worse than not touching the file. Codex's own tool produces valid TOML by construction and
 *   Codex's own reader is what verifies it afterwards.
 */

/** The plugin identifier, which is `plugin@marketplace` and is what settings.json keys on. */
const PLUGIN = "weeek@dsudomoin";

/** The MCP server name, in every client. */
const SERVER = "weeek";

/** Ours, and the only value in a weeek stanza that must never be echoed to a terminal. */
const TOKEN_VARIABLE = "WEEEK_API_TOKEN";

const ROOT_VARIABLE = "WEEEK_FILE_ROOT";

export type RunResult = { ok: boolean; stdout: string; stderr: string };

/**
 * Everything this file does to the outside world, in one object so a test can hand it a fake.
 *
 * Not a convenience: these functions edit other people's configuration by running other people's
 * programs, and a test that had to run the real `claude` and the real `codex` against a real home
 * directory would be a test nobody dares to run — which in practice means one that never runs.
 */
export type Host = {
  home: string;
  /** File contents, or null when it is absent or unreadable — the two are the same to us. */
  readText: (path: string) => string | null;
  /** Runs a program, or returns null when there is no such program on this machine. */
  run: (command: string, args: string[]) => RunResult | null;
  copy: (from: string, to: string) => void;
  exists: (path: string) => boolean;
};

export function defaultHost(): Host {
  return {
    home: homedir(),
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    run: (command, args) => {
      try {
        // stdin ignored: nothing here is interactive, and a subprocess that decided to prompt
        // would otherwise sit forever behind a wizard that has already taken the terminal.
        const stdout = execFileSync(command, args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { ok: true, stdout, stderr: "" };
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        // ENOENT here is the program not existing, which is a different answer from it failing:
        // "Codex is not installed" leads somewhere else than "Codex refused".
        if (failure.code === "ENOENT") return null;
        return { ok: false, stdout: failure.stdout ?? "", stderr: failure.stderr || failure.message };
      }
    },
    copy: (from, to) => copyFileSync(from, to),
    exists: (path) => existsSync(path),
  };
}

export type ClientKind = "claude-plugin" | "claude-mcp" | "codex";

export type Client = {
  kind: ClientKind;
  /** How the wizard names it in a sentence. */
  label: string;
  /** The root this client launches the server with today, or null when it sets none. */
  currentRoot: string | null;
};

/**
 * Which clients on this machine launch this server.
 *
 * Returns every one it finds rather than picking: somebody who uses both Claude Code and Codex
 * needs the directory in both, and a wizard that silently configured one of them would leave the
 * other refusing every path with nothing to explain why.
 */
export function detectClients(host: Host = defaultHost()): Client[] {
  return [claudePlugin(host), claudeMcp(host), codex(host)].filter(
    (client): client is Client => client !== null,
  );
}

function claudePlugin(host: Host): Client | null {
  const settings = readJson(host, claudeSettings(host));
  if (settings === null || asRecord(settings["enabledPlugins"])?.[PLUGIN] !== true) return null;

  return {
    kind: "claude-plugin",
    label: `Claude Code, plugin ${PLUGIN}`,
    currentRoot: pluginFileRoot(settings),
  };
}

/** The directory `.mcp.json` substitutes into the server's environment, as settings.json holds it. */
function pluginFileRoot(settings: Record<string, unknown>): string | null {
  const options = asRecord(asRecord(asRecord(settings["pluginConfigs"])?.[PLUGIN])?.["options"]);
  return nonEmpty(options?.["file_root"]);
}

function claudeMcp(host: Host): Client | null {
  // User scope only, which is the scope the README documents and the only one that is not tied to
  // one project directory. A project-scoped registration is deliberately out of reach: it belongs
  // to a repository somebody else may share, and changing it from here would be changing theirs.
  const stanza = claudeMcpStanza(host);
  if (stanza === null) return null;

  return {
    kind: "claude-mcp",
    label: "Claude Code, registered with `claude mcp add`",
    currentRoot: nonEmpty(asRecord(stanza["env"])?.[ROOT_VARIABLE]),
  };
}

function codex(host: Host): Client | null {
  const config = host.readText(codexConfig(host));
  if (config === null) return null;

  // A substring search, not a parse, and the distinction is the point: we have no TOML parser and
  // will not write one. This only has to answer "does Codex know about this server at all", and
  // both routes leave an unmistakable line — the hand-written stanza, or the installed plugin.
  const registered = config.includes(`[mcp_servers.${SERVER}]`);
  const installed = /\[plugins\."weeek@/.test(config);
  if (!registered && !installed) return null;

  // nonEmpty, not `?? null`: clearing the directory leaves WEEEK_FILE_ROOT set to "" rather than
  // removing it, which the server reads as no directory. Anything else here would print an empty
  // string back as though it were a path, and offer to keep it.
  return { kind: "codex", label: "Codex", currentRoot: nonEmpty(codexStanza(host)?.env[ROOT_VARIABLE]) };
}

/** What a client's configuration looked like after `init` was done with it. */
export type Applied =
  /** It already launches the server with this exact directory. */
  | { kind: "unchanged" }
  /** Written and read back. The backup is left on disk on purpose, named so it can be found. */
  | { kind: "written"; backup: string }
  /** Not written. `steps` are lines to use verbatim — a command to run, or a line to paste. */
  | { kind: "manual"; why: string; steps: string[]; note: string | null };

export function applyFileRoot(host: Host, client: Client, root: string): Applied {
  // An empty root and no root are the same state, and asking a client to write "" over nothing
  // would rewrite a file to say what it already says.
  if ((client.currentRoot ?? "") === root) return { kind: "unchanged" };

  switch (client.kind) {
    case "claude-plugin":
      return applyClaudePlugin(host, root);
    case "claude-mcp":
      return applyClaudeMcp(host, root);
    case "codex":
      return applyCodex(host, root);
  }
}

function applyClaudePlugin(host: Host, root: string): Applied {
  const command = ["claude", "plugin", "install", PLUGIN, "--config", `file_root=${root}`];
  const settings = claudeSettings(host);

  if (host.run("claude", ["--version"]) === null) {
    return {
      kind: "manual",
      why: "the `claude` command is not on this PATH, and its settings file is not ours to edit",
      steps: [printable(command)],
      note: null,
    };
  }

  const backup = backupOf(host, settings);
  if (backup === null) {
    return {
      kind: "manual",
      why: `${settings} could not be copied, and nothing here changes a file it cannot back up`,
      steps: [printable(command)],
      note: null,
    };
  }

  const result = host.run(command[0] ?? "", command.slice(1));

  // Read back, because `claude` reporting success is its claim and this is ours. A file that no
  // longer parses reads as null here, which is the one case the backup exists for.
  const after = readJson(host, settings);
  if (after !== null && pluginFileRoot(after) === root) return { kind: "written", backup };

  if (after === null) host.copy(backup, settings);

  return {
    kind: "manual",
    why:
      after === null
        ? `${settings} no longer parsed as JSON afterwards, so the backup was put back${detail(result)}`
        : `${settings} still does not carry the directory afterwards${detail(result)}`,
    steps: [printable(command)],
    note: `A copy of the file as it was is at ${backup}.`,
  };
}

function applyClaudeMcp(host: Host, root: string): Applied {
  const stanza = claudeMcpStanza(host) ?? {};
  const env: Record<string, string> = {};
  let hidden = false;

  for (const [name, value] of Object.entries(asRecord(stanza["env"]) ?? {})) {
    // The token is the one value that must not be printed. It is already in their file, so this
    // hides nothing from them — it keeps it out of terminal scrollback and out of whatever they
    // paste the command into next.
    if (name === TOKEN_VARIABLE) hidden = true;
    else if (typeof value === "string") env[name] = value;
  }
  env[ROOT_VARIABLE] = root;

  const add = ["claude", "mcp", "add", SERVER, "--scope", "user"];
  for (const [name, value] of Object.entries(env)) add.push("-e", `${name}=${value}`);
  add.push("--", ...launchOf(stanza));

  return {
    kind: "manual",
    why:
      "weeek is already registered here, and `claude mcp add` refuses to change an entry that " +
      "exists rather than merging into it. Removing and adding it back is the only route, so " +
      "this is left to you: the pair below carries over what is registered now",
    steps: [`claude mcp remove ${SERVER} --scope user && ${printable(add)}`],
    note: hidden
      ? `That registration also sets ${TOKEN_VARIABLE}, which is not printed here. Add it back ` +
        `with -e ${TOKEN_VARIABLE}=..., or leave it out and let the stored token be used.`
      : null,
  };
}

function applyCodex(host: Host, root: string): Applied {
  const config = codexConfig(host);
  const cli = codexCommand(host);
  const registered = (host.readText(config) ?? "").includes(`[mcp_servers.${SERVER}]`);

  if (cli === null) {
    // No command to run, so no command is printed. `codex mcp add` rewrites the stanza whole and
    // needs the launch command spelled out, which is exactly what we cannot read without Codex —
    // a half-written one would be worse than a line to paste.
    return {
      kind: "manual",
      why:
        "Codex launches this server on this machine, but the `codex` command is not on this PATH " +
        `to change its configuration, and ${config} is not ours to edit with our own code`,
      steps: registered ? [`${ROOT_VARIABLE} = "${root}"`] : [],
      note: registered
        ? `That line goes in the [mcp_servers.${SERVER}.env] table of ${config}.`
        : "Codex runs this server from the installed plugin, and a Codex plugin has no per-user " +
          "settings. Register the server yourself — the README has the command — with " +
          `${ROOT_VARIABLE} in its env.`,
    };
  }

  const stanza = codexStanza(host, cli);
  if (stanza === null) {
    return {
      kind: "manual",
      why: `\`codex mcp get ${SERVER}\` did not answer, so there is nothing here to change safely`,
      steps: [],
      note: null,
    };
  }

  // Codex knows this server only through the installed plugin: there is no [mcp_servers.weeek] in
  // config.toml to edit. Writing one would work — a stanza of that name takes the place of the
  // plugin's, verified — but it would also pin the version by hand and quietly stop plugin
  // upgrades from reaching this machine. That is the user's trade to make, not the wizard's.
  if (!registered) {
    return {
      kind: "manual",
      why:
        "Codex runs this server from the installed plugin, and a Codex plugin has no per-user " +
        "settings for the wizard to fill in. Registering the server directly is the way to give " +
        "it a directory, and it replaces the plugin's copy",
      steps: [codexAdd(cli, stanza, root), printable([cli, "plugin", "remove", PLUGIN])],
      note:
        "A registration of your own pins the version in the command above, so `codex plugin " +
        "upgrade` will no longer bring you a new server. Change it there when you want one.",
    };
  }

  // `codex mcp add` writes the stanza whole: whatever it is not told, it drops. Command, args and
  // env we can replay; these five it has no flag for, so a stanza carrying any of them can only be
  // rewritten by losing them. Verified by doing it — a startup_timeout_sec of 30 came back gone.
  if (stanza.unreproducible.length > 0) {
    return {
      kind: "manual",
      why:
        `that server sets ${stanza.unreproducible.join(" and ")}, which \`codex mcp add\` has no ` +
        `flag for — it rewrites the stanza from its arguments, so running it here would delete ` +
        `${stanza.unreproducible.length === 1 ? "that setting" : "those settings"} without a word`,
      // Not the `codex mcp add` line: printing the command we have just called destructive would
      // be inviting somebody to run it. One line by hand keeps everything.
      steps: [`${ROOT_VARIABLE} = "${root}"`],
      note: `That line goes in the [mcp_servers.${SERVER}.env] table of ${config}, and everything else there stays.`,
    };
  }

  const backup = backupOf(host, config);
  if (backup === null) {
    return {
      kind: "manual",
      why: `${config} could not be copied, and nothing here changes a file it cannot back up`,
      steps: [printable([cli, "mcp", "add", SERVER, "--env", `${ROOT_VARIABLE}=${root}`, "--", ...stanza.launch])],
      note: null,
    };
  }

  const result = host.run(cli, codexAddArguments(stanza, root));

  // Read back through Codex's own parser, which is the whole reason for going through its CLI:
  // this is the "does the file still parse" check that Node cannot make for a TOML file.
  const after = codexStanza(host, cli);
  if (after?.env[ROOT_VARIABLE] === root) return { kind: "written", backup };

  host.copy(backup, config);
  return {
    kind: "manual",
    why:
      after === null
        ? `${config} would not read back afterwards, so the backup was put back${detail(result)}`
        : `${config} did not carry the directory afterwards, so the backup was put back${detail(result)}`,
    steps: [],
    note: `A copy of the file as it was is at ${backup}.`,
  };
}

/**
 * The arguments for `codex mcp add`, replaying the stanza with the directory changed.
 *
 * One builder for the command we run and the command we print, because they must not drift: a
 * printed line that leaves out what the run line replays would delete the user's own settings the
 * moment they follow our advice — `npm_config_fetch_retries` first of all, which is the one thing
 * this project's README insists they set.
 */
function codexAddArguments(stanza: CodexStanza, root: string): string[] {
  const args = ["mcp", "add", SERVER];
  for (const [name, value] of Object.entries({ ...stanza.env, [ROOT_VARIABLE]: root })) {
    args.push("--env", `${name}=${value}`);
  }
  return [...args, "--", ...stanza.launch];
}

function codexAdd(cli: string, stanza: CodexStanza, root: string): string {
  return printable([cli, ...codexAddArguments(stanza, root)]);
}

type CodexStanza = {
  /** The command and its arguments, ready to follow `--`. */
  launch: string[];
  env: Record<string, string>;
  /** Fields `codex mcp add` cannot write, named so the refusal can say what would be lost. */
  unreproducible: string[];
};

function codexStanza(host: Host, cli: string | null = codexCommand(host)): CodexStanza | null {
  if (cli === null) return null;

  const result = host.run(cli, ["mcp", "get", SERVER, "--json"]);
  if (result === null || !result.ok) return null;

  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = asRecord(JSON.parse(result.stdout));
  } catch {
    return null;
  }
  if (parsed === undefined) return null;

  const transport = asRecord(parsed["transport"]);
  if (transport?.["type"] !== "stdio") return null;

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(asRecord(transport["env"]) ?? {})) {
    // An unsubstituted `${user_config.…}` is what Codex reports for a server the plugin supplies:
    // Codex has no such substitution and passes the text through as it stands. Copying one into
    // config.toml would make a placeholder permanent, and it is never a value anybody meant.
    if (typeof value === "string" && !/\$\{[^}]*\}/.test(value)) env[name] = value;
  }

  const unreproducible = [
    ["startup_timeout_sec", parsed["startup_timeout_sec"]],
    ["tool_timeout_sec", parsed["tool_timeout_sec"]],
    ["enabled_tools", parsed["enabled_tools"]],
    ["disabled_tools", parsed["disabled_tools"]],
    ["cwd", transport["cwd"]],
  ]
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name]) => String(name));

  const args = Array.isArray(transport["args"]) ? transport["args"] : [];
  return {
    launch: [String(transport["command"] ?? ""), ...args.map(String)],
    env,
    unreproducible,
  };
}

/**
 * Codex on the PATH, or the copy inside the macOS application bundle.
 *
 * The bundle is not a guess: a machine where Codex was installed as an application and never as a
 * CLI has that binary and nothing on the PATH, which is the state of the machine this was written
 * on. Getting it wrong costs nothing — an absent path means we print the command instead of
 * running it, which is what we would have done anyway.
 */
function codexCommand(host: Host): string | null {
  if (host.run("codex", ["--version"]) !== null) return "codex";

  for (const bundled of [
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
  ]) {
    if (host.exists(bundled)) return bundled;
  }
  return null;
}

/** The command and arguments a `claude mcp add` stanza launches, ready to follow `--`. */
function launchOf(stanza: Record<string, unknown>): string[] {
  const args = Array.isArray(stanza["args"]) ? stanza["args"] : [];
  return [String(stanza["command"] ?? ""), ...args.map(String)];
}

function claudeMcpStanza(host: Host): Record<string, unknown> | null {
  const config = readJson(host, join(host.home, ".claude.json"));
  return asRecord(asRecord(config?.["mcpServers"])?.[SERVER]) ?? null;
}

function claudeSettings(host: Host): string {
  return join(host.home, ".claude", "settings.json");
}

function codexConfig(host: Host): string {
  return join(host.home, ".codex", "config.toml");
}

/**
 * Copies a file beside itself before somebody else's program rewrites it, or null when it cannot.
 *
 * Deliberately one fixed name rather than a timestamp: a directory filling with copies is litter
 * nobody prunes, and the copy that matters is the one from just before the last write. It is never
 * removed afterwards, including on success — a backup that deletes itself once the write "worked"
 * is missing exactly when the judgement of "worked" turns out to have been wrong.
 */
function backupOf(host: Host, path: string): string | null {
  const backup = `${path}.weeek-mcp-backup`;
  try {
    host.copy(path, backup);
    return backup;
  } catch {
    return null;
  }
}

function readJson(host: Host, path: string): Record<string, unknown> | null {
  const text = host.readText(path);
  if (text === null) return null;
  try {
    return asRecord(JSON.parse(text)) ?? null;
  } catch {
    return null;
  }
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function detail(result: RunResult | null): string {
  const said = result?.stderr.trim() || result?.stdout.trim();
  return said ? `. It said: ${said}` : "";
}

/** A command as a person would type it, quoted where a shell would otherwise take it apart. */
function printable(command: string[]): string {
  return command.map(shellQuote).join(" ");
}

function shellQuote(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
