# weeek-mcp

An MCP server for [Weeek](https://weeek.net). It lets Claude Code and OpenAI Codex work with your
task tracker in ordinary words — "what is on the board", "assign this to Anna and comment that the
build is fixed" — instead of you switching to a browser to look it up and type it in.

Thirteen tools cover twenty-four API operations. They are curated rather than generated one per
endpoint, which is what keeps the tool list small enough to carry in every request.

Requires **Node 22.18 or newer**.

## Install

### Claude Code

```bash
claude plugin marketplace add dsudomoin/weeek-mcp
claude plugin install weeek@dsudomoin
```

### Codex

```bash
codex plugin marketplace add dsudomoin/weeek-mcp
codex plugin add weeek@dsudomoin
```

Or register it by hand in `~/.codex/config.toml`:

```toml
[mcp_servers.weeek]
command = "npx"
args = ["-y", "@dsudomoin/weeek-mcp@0.1.0"]

[mcp_servers.weeek.env]
# Turns an unreachable registry into a one-second error instead of a 70-second hang.
npm_config_fetch_retries = "0"
```

Codex fails the **whole config file** on one unrecognised key, taking every other MCP server with
it, so copy the block rather than retyping it.

### Installed once, run from disk

Both routes above fetch from npm each time the server starts. Install it instead if you work
offline, sit behind a corporate proxy, or want the version to change only when you say so:

```bash
npm install -g @dsudomoin/weeek-mcp
claude mcp add weeek --scope user -- weeek-mcp
```

## The token

Create one in Weeek under **Settings → API**, then give it to the server once, from your terminal:

```bash
weeek-mcp init
```

It asks for the token without showing it, checks it against Weeek before storing anything, and puts
it in your operating system's keychain — then tells you which store it used. Every client on the
machine finds it there. If you installed nothing, `npx -y @dsudomoin/weeek-mcp init` runs the same
wizard.

`WEEEK_API_TOKEN` in the environment always wins over the stored one, which is what makes
containers and CI work. Claude Code can also hold the token itself, through
`/plugin configure weeek@dsudomoin`.

On Linux with no session D-Bus — a container, an SSH session, a headless box — there is no
keychain to put it in, so the token goes to a file that only you can read. The wizard names that
file when it does, which is why the line it prints is worth reading.

## The tools

Four that read:

| Tool | |
| --- | --- |
| `weeek_context` | You, the workspace, its projects, members and tags. Every id starts here. |
| `weeek_search_tasks` | Finds tasks by project, board, assignee, tag, type, priority, text, date. |
| `weeek_get_task` | One task with its description as markdown and its comment thread. |
| `weeek_list_comments` | The thread on its own, for paging back through a long one. |

Nine that change something:

| Tool | |
| --- | --- |
| `weeek_create_task` | Creates a task. The only place a description can be set. |
| `weeek_update_task` | Title, priority, type, start and due dates, duration, tags. |
| `weeek_move_task` | Moves it to another board, another column, or both. |
| `weeek_complete_task` | Completes or reopens, and says when a recurring task spawned another. |
| `weeek_set_task_people` | Adds and removes assignees and watchers. |
| `weeek_add_comment` | Posts a comment or a reply. Markdown survives as written. |
| `weeek_get_attachment` | Downloads an attachment and returns the path it was saved to. |
| `weeek_upload_attachment` | Attaches a local file to a task. |
| `weeek_delete_comment` | Deletes a comment permanently. |

Answers are shaped for reading, not raw API JSON: names instead of ids, markdown instead of HTML,
and a sentence saying how to fetch the next page.

## Three things Weeek does that will cost you work

Found by experiment, and each contradicts what you would reasonably assume.

- **A description can only be set when the task is created.** Weeek accepts one on an update,
  answers success, and stores nothing. Write it at creation or not at all.
- **Updating tags replaces the whole list.** There is no add-one endpoint. To add a tag, read the
  task's tags first and send them all back with the new one — otherwise every other tag is gone.
- **Comments cannot be edited.** The API offers create and delete, nothing else.

## Attaching files

Two tools touch your disk, and the paths come from the model — which has just been reading task
descriptions and comments that other people wrote. Text like that can carry instructions, so the
boundary is yours to draw and neither tool can widen it:

```bash
WEEEK_FILE_ROOT=/Users/you/work/weeek-files
```

Unset, both tools refuse every path, which is the safe default. Set, uploading can read **any file
inside that directory** — so choose one that holds nothing private and that nothing executes from.
`$HOME` is honoured and warned about; a filesystem root is refused outright.

## Environment variables

| Variable | |
| --- | --- |
| `WEEEK_API_TOKEN` | Overrides the stored token. |
| `WEEEK_FILE_ROOT` | The one directory the attachment tools may touch. Unset by default. |
| `WEEEK_BASE_URL` | Defaults to `https://api.weeek.net/public/v1`. |
| `WEEEK_TIMEOUT_MS` | Per request, defaults to `30000`. |

## Development

```bash
npm install
npm test        # runs straight from the TypeScript sources
npm run check   # tsc --noEmit
npm run build   # esbuild → dist/server.mjs, the file npm publishes
```

`src/generated/weeek-openapi.ts` is a committed snapshot of Weeek's OpenAPI spec; refresh it with
`npm run update:openapi`, which downloads and executes code from their docs site.

## Licence

MIT — see [LICENSE](LICENSE). The published file is a bundle, so the licences
of everything compiled into it travel with it in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
