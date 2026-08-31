import { test } from "node:test";
import assert from "node:assert/strict";
import { type Client, type Host, type RunResult, applyFileRoot, detectClients } from "./clients.ts";

// Every one of these behaviours is a write into somebody else's configuration, performed by
// somebody else's program. Driving the real `claude` and the real `codex` against a real home
// directory would make a suite nobody dares to run, so the whole outside world arrives through
// Host. What the fake must be faithful about is narrow and known: which files exist, what a
// program does to them, and the difference between a program that failed and one that is not
// installed. The shapes below are transcripts of the real tools, not inventions.

const HOME = "/home/tester";
const CLAUDE_SETTINGS = `${HOME}/.claude/settings.json`;
const CLAUDE_CONFIG = `${HOME}/.claude.json`;
const CODEX_CONFIG = `${HOME}/.codex/config.toml`;

type Program = (args: string[], files: Record<string, string>) => RunResult | null;

function fakeHost(setup: { files?: Record<string, string>; programs?: Record<string, Program> }): {
  host: Host;
  files: Record<string, string>;
  ran: { command: string; args: string[] }[];
} {
  const files: Record<string, string> = { ...setup.files };
  const ran: { command: string; args: string[] }[] = [];

  const host: Host = {
    home: HOME,
    readText: (path) => files[path] ?? null,
    run: (command, args) => {
      ran.push({ command, args });
      // Absent from the map is absent from the machine, which is the distinction the real host
      // draws with ENOENT and the one that decides between running a command and printing it.
      const program = setup.programs?.[command];
      return program === undefined ? null : program(args, files);
    },
    copy: (from, to) => {
      const text = files[from];
      if (text === undefined) throw new Error(`no such file: ${from}`);
      files[to] = text;
    },
    exists: (path) => files[path] !== undefined,
  };

  return { host, files, ran };
}

function claudeSettings(options: Record<string, unknown> | null): string {
  return JSON.stringify({
    enabledPlugins: { "weeek@dsudomoin": true, "other@somewhere": true },
    ...(options === null ? {} : { pluginConfigs: { "weeek@dsudomoin": { options } } }),
  });
}

/** `claude plugin install --config` merging one key into what is already stored. */
const claudeCli: Program = (args, files) => {
  if (args[0] === "--version") return ok("2.1.251");
  if (args[0] !== "plugin" || args[1] !== "install") return ok("");

  const setting = args[args.indexOf("--config") + 1] ?? "";
  const [key = "", value = ""] = setting.split("=");
  const settings = JSON.parse(files[CLAUDE_SETTINGS] ?? "{}") as {
    pluginConfigs?: Record<string, { options?: Record<string, string> }>;
  };
  const configs = (settings.pluginConfigs ??= {});
  const entry = (configs["weeek@dsudomoin"] ??= {});
  entry.options = { ...entry.options, [key]: value };

  files[CLAUDE_SETTINGS] = JSON.stringify(settings);
  return ok("Installed plugin weeek@dsudomoin");
};

/** The shape `codex mcp get weeek --json` answers with, mutated by `codex mcp add`. */
function codexSimulator(initial?: Partial<Record<string, unknown>>): {
  program: Program;
  stanza: Record<string, unknown> | null;
} {
  const state = {
    program: (() => null) as Program,
    stanza: {
      name: "weeek",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@dsudomoin/weeek-mcp@0.2.0"],
        env: { npm_config_fetch_retries: "0" },
        cwd: null,
      },
      startup_timeout_sec: null,
      tool_timeout_sec: null,
      enabled_tools: null,
      disabled_tools: null,
      ...initial,
    } as Record<string, unknown> | null,
  };

  state.program = (args, files) => {
    if (args[0] === "--version") return ok("codex-cli 0.146.0-alpha.3.1");
    if (args[1] === "get") {
      return state.stanza === null ? failed("No MCP server named weeek") : ok(JSON.stringify(state.stanza));
    }
    if (args[1] !== "add") return failed("unknown subcommand");

    // The real thing rewrites the whole stanza from its arguments — verified by watching a
    // startup_timeout_sec disappear — so the fake does the same, and keeps nothing.
    const env: Record<string, string> = {};
    const launch: string[] = [];
    for (let index = 2; index < args.length; index += 1) {
      if (args[index] === "--env") {
        const [name = "", ...rest] = (args[index + 1] ?? "").split("=");
        env[name] = rest.join("=");
        index += 1;
      } else if (args[index] === "--") {
        launch.push(...args.slice(index + 1));
        break;
      }
    }

    state.stanza = {
      name: "weeek",
      transport: { type: "stdio", command: launch[0], args: launch.slice(1), env, cwd: null },
      startup_timeout_sec: null,
      tool_timeout_sec: null,
      enabled_tools: null,
      disabled_tools: null,
    };
    files[CODEX_CONFIG] = `[mcp_servers.weeek]\ncommand = "${launch[0] ?? ""}"\n`;
    return ok("Added global MCP server 'weeek'.");
  };

  return state;
}

function ok(stdout: string): RunResult {
  return { ok: true, stdout, stderr: "" };
}

function failed(stderr: string): RunResult {
  return { ok: false, stdout: "", stderr };
}

function only(clients: Client[], kind: Client["kind"]): Client {
  const found = clients.find((client) => client.kind === kind);
  assert.ok(found, `no ${kind} was detected among ${clients.map((c) => c.kind).join(", ") || "none"}`);
  return found;
}

test("a machine with nothing installed has no client to configure", () => {
  const { host } = fakeHost({});

  assert.deepEqual(detectClients(host), []);
});

test("the enabled Claude plugin is found, with the directory it currently uses", () => {
  const { host } = fakeHost({
    files: { [CLAUDE_SETTINGS]: claudeSettings({ file_root: "/home/tester/weeek" }) },
  });

  assert.equal(only(detectClients(host), "claude-plugin").currentRoot, "/home/tester/weeek");
});

test("a plugin that is present but switched off is not a client", () => {
  // enabledPlugins keeps disabled plugins as `false` rather than dropping them, so the value is
  // what decides. Treating the key's presence as installation would configure a plugin that never
  // launches anything, and say so out loud.
  const { host } = fakeHost({
    files: { [CLAUDE_SETTINGS]: JSON.stringify({ enabledPlugins: { "weeek@dsudomoin": false } }) },
  });

  assert.deepEqual(detectClients(host), []);
});

test("a plugin with no directory set reports none rather than guessing one", () => {
  const { host } = fakeHost({ files: { [CLAUDE_SETTINGS]: claudeSettings(null) } });

  assert.equal(only(detectClients(host), "claude-plugin").currentRoot, null);
});

test("a `claude mcp add` registration is found, with the directory in its environment", () => {
  const { host } = fakeHost({
    files: {
      [CLAUDE_CONFIG]: JSON.stringify({
        mcpServers: {
          weeek: { command: "weeek-mcp", env: { WEEEK_FILE_ROOT: "/srv/files" } },
          other: { command: "other" },
        },
      }),
    },
  });

  assert.equal(only(detectClients(host), "claude-mcp").currentRoot, "/srv/files");
});

test("Codex is found from its own stanza, and the directory read back through its own tool", () => {
  const codex = codexSimulator({
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@dsudomoin/weeek-mcp@0.2.0"],
      env: { WEEEK_FILE_ROOT: "/srv/codex" },
      cwd: null,
    },
  });
  const { host } = fakeHost({
    files: { [CODEX_CONFIG]: "[mcp_servers.weeek]\ncommand = \"npx\"\n" },
    programs: { codex: codex.program },
  });

  assert.equal(only(detectClients(host), "codex").currentRoot, "/srv/codex");
});

test("Codex is found when only its plugin is installed, with no stanza of its own", () => {
  const codex = codexSimulator();
  const { host } = fakeHost({
    files: { [CODEX_CONFIG]: '[plugins."weeek@dsudomoin"]\nenabled = true\n' },
    programs: { codex: codex.program },
  });

  assert.equal(only(detectClients(host), "codex").currentRoot, null);
});

test("a Codex directory that was cleared reads as no directory, not as an empty path", () => {
  // Clearing sets WEEEK_FILE_ROOT to "" rather than removing it — `codex mcp add --env KEY=` is
  // accepted and stores the empty string. The server reads that as unset, and so must this, or the
  // wizard prints an empty string back as a path and offers to keep it.
  const codex = codexSimulator({
    transport: {
      type: "stdio",
      command: "npx",
      args: [],
      env: { WEEEK_FILE_ROOT: "" },
      cwd: null,
    },
  });
  const { host } = fakeHost({
    files: { [CODEX_CONFIG]: "[mcp_servers.weeek]\n" },
    programs: { codex: codex.program },
  });

  assert.equal(only(detectClients(host), "codex").currentRoot, null);
});

test("a Codex config that never mentions this server is not a client", () => {
  const { host } = fakeHost({
    files: { [CODEX_CONFIG]: '[mcp_servers.other]\ncommand = "other"\n' },
    programs: { codex: codexSimulator().program },
  });

  assert.deepEqual(detectClients(host), []);
});

test("all three are found together, because somebody may use all three", () => {
  const { host } = fakeHost({
    files: {
      [CLAUDE_SETTINGS]: claudeSettings({ file_root: "/a" }),
      [CLAUDE_CONFIG]: JSON.stringify({ mcpServers: { weeek: { command: "weeek-mcp" } } }),
      [CODEX_CONFIG]: "[mcp_servers.weeek]\n",
    },
    programs: { codex: codexSimulator().program },
  });

  assert.deepEqual(
    detectClients(host).map((client) => client.kind),
    ["claude-plugin", "claude-mcp", "codex"],
  );
});

test("a client that already launches this directory is left alone entirely", () => {
  const { host, ran } = fakeHost({
    files: { [CLAUDE_SETTINGS]: claudeSettings({ file_root: "/srv/files" }) },
    programs: { claude: claudeCli },
  });
  const client = only(detectClients(host), "claude-plugin");

  assert.deepEqual(applyFileRoot(host, client, "/srv/files"), { kind: "unchanged" });
  assert.deepEqual(ran, [], "something was run to write a value that was already there");
});

test("clearing a client that has no directory changes nothing", () => {
  // "" and unset are one state. Without this the wizard would rewrite a file to say what it says.
  const { host, ran } = fakeHost({
    files: { [CLAUDE_SETTINGS]: claudeSettings(null) },
    programs: { claude: claudeCli },
  });

  assert.deepEqual(applyFileRoot(host, only(detectClients(host), "claude-plugin"), ""), {
    kind: "unchanged",
  });
  assert.deepEqual(ran, []);
});

test("the Claude plugin is written through claude itself, backed up first and read back after", () => {
  const { host, files, ran } = fakeHost({
    files: { [CLAUDE_SETTINGS]: claudeSettings({ api_token: "secret" }) },
    programs: { claude: claudeCli },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "claude-plugin"), "/srv/files");

  assert.equal(applied.kind, "written");
  assert.equal(applied.backup, `${CLAUDE_SETTINGS}.weeek-mcp-backup`);
  assert.deepEqual(ran.at(-1), {
    command: "claude",
    args: ["plugin", "install", "weeek@dsudomoin", "--config", "file_root=/srv/files"],
  });

  // The merge is the whole reason this route is safe to take: a token the person set through the
  // same mechanism has to survive a write that only mentions the directory.
  const after = JSON.parse(files[CLAUDE_SETTINGS] ?? "{}") as {
    pluginConfigs: { "weeek@dsudomoin": { options: Record<string, string> } };
  };
  assert.deepEqual(after.pluginConfigs["weeek@dsudomoin"].options, {
    api_token: "secret",
    file_root: "/srv/files",
  });
  assert.ok(files[`${CLAUDE_SETTINGS}.weeek-mcp-backup`], "no backup was left behind");
});

test("with claude off the PATH nothing is run and the command is printed instead", () => {
  const { host, ran } = fakeHost({
    files: { [CLAUDE_SETTINGS]: claudeSettings(null) },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "claude-plugin"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.deepEqual(applied.steps, [
    "claude plugin install weeek@dsudomoin --config file_root=/srv/files",
  ]);
  assert.deepEqual(ran, [{ command: "claude", args: ["--version"] }]);
});

test("a write that claude reports but does not make is reported as not made", () => {
  // The check that matters: `claude` exiting zero is its claim, and reading the file back is ours.
  const silent: Program = (args) => (args[0] === "--version" ? ok("2.1.251") : ok("Installed"));
  const { host } = fakeHost({
    files: { [CLAUDE_SETTINGS]: claudeSettings(null) },
    programs: { claude: silent },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "claude-plugin"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.match(applied.why, /does not carry the directory/);
});

test("settings.json left unparseable is put back from the backup", () => {
  const wrecker: Program = (args, files) => {
    if (args[0] === "--version") return ok("2.1.251");
    files[CLAUDE_SETTINGS] = "{ this is not json";
    return failed("crashed halfway");
  };
  const { host, files } = fakeHost({
    files: { [CLAUDE_SETTINGS]: claudeSettings({ api_token: "secret" }) },
    programs: { claude: wrecker },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "claude-plugin"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.match(applied.why, /no longer parsed as JSON/);
  assert.match(applied.why, /crashed halfway/);
  assert.deepEqual(JSON.parse(files[CLAUDE_SETTINGS] ?? ""), JSON.parse(claudeSettings({ api_token: "secret" })));
});

test("an existing `claude mcp add` registration is never touched, only explained", () => {
  const { host, ran } = fakeHost({
    files: {
      [CLAUDE_CONFIG]: JSON.stringify({
        mcpServers: {
          weeek: {
            command: "weeek-mcp",
            args: ["--flag"],
            env: { npm_config_fetch_retries: "0" },
          },
        },
      }),
    },
    programs: { claude: claudeCli },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "claude-mcp"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.deepEqual(ran, [], "the registration was written to rather than explained");
  assert.deepEqual(applied.steps, [
    "claude mcp remove weeek --scope user && claude mcp add weeek --scope user " +
      "-e npm_config_fetch_retries=0 -e WEEEK_FILE_ROOT=/srv/files -- weeek-mcp --flag",
  ]);
});

test("a token in that registration is not printed back to the terminal", () => {
  // It is already in their file, so this hides nothing from them. It keeps the token out of
  // terminal scrollback and out of whatever they paste the command into next.
  const { host } = fakeHost({
    files: {
      [CLAUDE_CONFIG]: JSON.stringify({
        mcpServers: { weeek: { command: "weeek-mcp", env: { WEEEK_API_TOKEN: "s3cret" } } },
      }),
    },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "claude-mcp"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.ok(!applied.steps.join(" ").includes("s3cret"), "the token was printed");
  assert.match(applied.note ?? "", /WEEEK_API_TOKEN/);
});

test("Codex is rewritten through its own tool, carrying over the environment already there", () => {
  const codex = codexSimulator();
  const { host } = fakeHost({
    files: { [CODEX_CONFIG]: '[mcp_servers.weeek]\ncommand = "npx"\n' },
    programs: { codex: codex.program },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "codex"), "/srv/files");

  assert.equal(applied.kind, "written");
  assert.equal(applied.backup, `${CODEX_CONFIG}.weeek-mcp-backup`);

  // `codex mcp add` writes the stanza whole, so anything not replayed is lost — including the one
  // setting this project's own README tells people to put there.
  const transport = (codex.stanza?.["transport"] ?? {}) as Record<string, unknown>;
  assert.deepEqual(transport["env"], {
    npm_config_fetch_retries: "0",
    WEEEK_FILE_ROOT: "/srv/files",
  });
  assert.deepEqual(transport["args"], ["-y", "@dsudomoin/weeek-mcp@0.2.0"]);
});

test("a Codex stanza with settings the tool cannot write back is left alone", () => {
  // `codex mcp add` has no flag for startup_timeout_sec, and rewriting the stanza would drop it
  // without a word. Measured on the real tool: a 30 went in and came back gone.
  const codex = codexSimulator({ startup_timeout_sec: 30 });
  const { host, ran } = fakeHost({
    files: { [CODEX_CONFIG]: "[mcp_servers.weeek]\n" },
    programs: { codex: codex.program },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "codex"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.match(applied.why, /startup_timeout_sec/);
  assert.ok(
    !ran.some((call) => call.args[1] === "add"),
    "the stanza was rewritten despite carrying a setting that cannot be written back",
  );
  // And it does not print the command it has just called destructive: that would be inviting
  // somebody to run it. A line to paste by hand keeps everything.
  assert.deepEqual(applied.steps, ['WEEEK_FILE_ROOT = "/srv/files"']);
});

test("an unsubstituted plugin placeholder is never copied into a Codex stanza", () => {
  // Codex has no ${user_config.…} substitution and reports the text as it stands. Replaying one
  // into config.toml would make a placeholder permanent, and it is never a value anybody meant.
  const codex = codexSimulator({
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@dsudomoin/weeek-mcp@0.2.0"],
      env: { WEEEK_API_TOKEN: "${user_config.api_token}", npm_config_fetch_retries: "0" },
      cwd: null,
    },
  });
  const { host } = fakeHost({
    files: { [CODEX_CONFIG]: "[mcp_servers.weeek]\n" },
    programs: { codex: codex.program },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "codex"), "/srv/files");

  assert.equal(applied.kind, "written");
  const transport = (codex.stanza?.["transport"] ?? {}) as Record<string, unknown>;
  assert.deepEqual(transport["env"], {
    npm_config_fetch_retries: "0",
    WEEEK_FILE_ROOT: "/srv/files",
  });
});

test("a Codex plugin with no stanza of its own is explained rather than shadowed", () => {
  // Registering the server would work — a stanza of that name takes the place of the plugin's —
  // but it also pins the version by hand and stops plugin upgrades reaching the machine. That is
  // the user's trade to make.
  const codex = codexSimulator();
  const { host, ran } = fakeHost({
    files: { [CODEX_CONFIG]: '[plugins."weeek@dsudomoin"]\nenabled = true\n' },
    programs: { codex: codex.program },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "codex"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.ok(
    !ran.some((call) => call.args[1] === "add"),
    "a stanza was written that shadows the installed plugin",
  );
  // The printed command replays the plugin's own environment. Leaving it out would delete
  // npm_config_fetch_retries the moment somebody followed our advice — the one setting this
  // project's README insists on, and the reason a careful user would suffer more than a careless one.
  assert.equal(
    applied.steps[0],
    "codex mcp add weeek --env npm_config_fetch_retries=0 --env WEEEK_FILE_ROOT=/srv/files " +
      "-- npx -y @dsudomoin/weeek-mcp@0.2.0",
  );
  assert.match(applied.note ?? "", /upgrade/);
});

test("a Codex config left unreadable afterwards is put back from the backup", () => {
  const codex = codexSimulator();
  const original = "[mcp_servers.weeek]\ncommand = \"npx\"\n";
  const { host, files } = fakeHost({
    files: { [CODEX_CONFIG]: original },
    programs: {
      codex: (args, contents) => {
        if (args[1] !== "add") return codex.program(args, contents);
        // The write that leaves the file in a state Codex will not read back: the one case the
        // backup exists for, and the one Node cannot check for itself without a TOML parser.
        codex.stanza = null;
        contents[CODEX_CONFIG] = "[mcp_servers.weeek";
        return ok("Added global MCP server 'weeek'.");
      },
    },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "codex"), "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.match(applied.why, /would not read back/);
  assert.equal(files[CODEX_CONFIG], original);
});

test("with no codex command anywhere, a line to paste is given rather than a broken command", () => {
  // `codex mcp add` rewrites the stanza whole and needs the launch command spelled out — which is
  // precisely what cannot be read without Codex. Printing it half-written would hand somebody a
  // command that drops their own settings when they run it.
  const { host, ran } = fakeHost({
    files: { [CODEX_CONFIG]: "[mcp_servers.weeek]\n" },
  });

  const applied = applyFileRoot(host, { kind: "codex", label: "Codex", currentRoot: null }, "/srv/files");

  assert.equal(applied.kind, "manual");
  assert.deepEqual(applied.steps, ['WEEEK_FILE_ROOT = "/srv/files"']);
  assert.match(applied.note ?? "", /\[mcp_servers\.weeek\.env\]/);
  assert.deepEqual(ran, [{ command: "codex", args: ["--version"] }]);
});

test("Codex inside the macOS application bundle is found when nothing is on the PATH", () => {
  // A machine where Codex was installed as an application and never as a CLI has that binary and
  // nothing on the PATH. Without this the wizard would only ever print commands that machine
  // cannot run either.
  const bundled = "/Applications/Codex.app/Contents/Resources/codex";
  const codex = codexSimulator();
  const { host } = fakeHost({
    files: { [CODEX_CONFIG]: "[mcp_servers.weeek]\n", [bundled]: "" },
    programs: { [bundled]: codex.program },
  });

  const applied = applyFileRoot(host, only(detectClients(host), "codex"), "/srv/files");

  assert.equal(applied.kind, "written");
});
