# weeek-mcp

An MCP server for [Weeek](https://weeek.net). It lets Claude Code and OpenAI Codex work with your
task tracker in ordinary words — "what is on the board", "assign this to Anna and comment that the
build is fixed" — instead of you switching to a browser to look it up and type it in.

Twelve tools cover twenty-three API operations. They are curated rather than generated one per
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

That is all of it. Under Codex the token comes from this machine's keychain and from nowhere else:
a Codex plugin cannot ask you for a setting, so there is no field to paste a token into and
`weeek-mcp init` below is the way to supply one. That is how Codex works rather than something
missing here.

### Installed once, run from disk

Both routes above fetch from npm each time the server starts. Install it instead if you work
offline, sit behind a corporate proxy, or want the version to change only when you say so:

```bash
npm install -g @dsudomoin/weeek-mcp
claude mcp add weeek --scope user -- weeek-mcp
```

## Setup

Create a token in Weeek under **Settings → API**, then run the wizard once, from your terminal:

```bash
weeek-mcp init
```

It asks for the token without showing it, checks it against Weeek before storing anything, and puts
it in your operating system's keychain — then tells you which store it used. Every client on the
machine finds it there. Run it again whenever the token should change — Enter keeps what is already
there. If you installed nothing, `npx -y @dsudomoin/weeek-mcp init` runs the same wizard.

Restart your client afterwards. The token is read once, when the server starts.

`WEEEK_API_TOKEN` in the environment always wins over the stored one, which is what makes
containers and CI work. Claude Code can also hold the token in the plugin's own settings.

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

Eight that change something:

| Tool | |
| --- | --- |
| `weeek_create_task` | Creates a task. The only place a description can be set. |
| `weeek_update_task` | Title, priority, type, start and due dates, duration, tags. |
| `weeek_move_task` | Moves it to another board, another column, or both. |
| `weeek_complete_task` | Completes or reopens, and says when a recurring task spawned another. |
| `weeek_set_task_people` | Adds and removes assignees and watchers. |
| `weeek_add_comment` | Posts a comment or a reply. Markdown survives as written. |
| `weeek_get_attachment` | Downloads an attachment into a temporary directory and returns the path. |
| `weeek_delete_comment` | Deletes a comment permanently. |

Answers are shaped for reading, not raw API JSON: names instead of ids, markdown instead of HTML,
and a sentence saying how to fetch the next page.

**Upgrading from 0.1.0:** `weeek_upload_attachment` is gone, and with it `WEEEK_FILE_ROOT` and
`weeek_get_attachment`'s `saveTo` argument. Nothing here uploads a file any more, and nothing here
writes to a path you name — attach files in Weeek itself. Downloading is unchanged apart from
where the file lands, and it now needs no configuration at all.

## Three things Weeek does that will cost you work

Found by experiment, and each contradicts what you would reasonably assume.

- **A description can only be set when the task is created.** Weeek accepts one on an update,
  answers success, and stores nothing. Write it at creation or not at all.
- **Updating tags replaces the whole list.** There is no add-one endpoint. To add a tag, read the
  task's tags first and send them all back with the new one — otherwise every other tag is gone.
- **Comments cannot be edited.** The API offers create and delete, nothing else.

## Environment variables

| Variable | |
| --- | --- |
| `WEEEK_API_TOKEN` | Overrides the stored token. |
| `WEEEK_BASE_URL` | Defaults to `https://api.weeek.net/public/v1`. |
| `WEEEK_TIMEOUT_MS` | Per request, defaults to `30000`. |

## Development

```bash
npm install
npm test        # builds, then runs straight from the TypeScript sources
npm run check   # tsc --noEmit
npm run build   # esbuild → dist/server.mjs, the file npm publishes
```

`npm test` builds first, through a `pretest` script, and it has to: `dist/` is not committed, and
two tests read what the build produces — one checks that the file `bin` points at exists, another
that the committed `THIRD-PARTY-NOTICES.md` still matches what the current sources bundle. The
build takes about 0.2 s against a 1.6 s run, so it costs nothing to always be right.

CI runs the suite on Node 22.18 — the floor `engines` declares — on the latest Node 22, and on 24,
which is what releases are published from. Node 23 is the one version in that declared range that
will not work: type stripping stayed behind a flag until 23.6, so `node --test` cannot read a `.ts`
file before then. The line has been end-of-life since 2025.

`src/generated/weeek-openapi.ts` is a committed snapshot of Weeek's OpenAPI spec; refresh it with
`npm run update:openapi`, which downloads and executes code from their docs site.

## Releasing

Releases are cut by CI. Pushing a tag is the whole of it — nothing is published from a laptop, and
there is no npm token anywhere: GitHub Actions proves its identity to npm over OIDC, and npm checks
that against a trusted publisher pinned to this repository and to `.github/workflows/publish.yml`.

The version lives in six files that have to agree, and `npm test` is what holds them together:

- `package.json`
- `.claude-plugin/marketplace.json`
- `plugins/weeek/.claude-plugin/plugin.json`
- `plugins/weeek/.codex-plugin/plugin.json`
- `plugins/weeek/.mcp.json` — the exact version each client launches through `npx`
- `plugins/weeek/.codex-plugin/mcp.json` — the same, for Codex

So, to release `0.3.0`:

```bash
# Bump all six by hand first. `npm version` will not do it: it knows about package.json and
# the lockfile and nothing else, and the four it misses are the ones users actually install from.
npm install          # refreshes package-lock.json to match
npm test             # builds, then refuses if any of the six disagrees
git add THIRD-PARTY-NOTICES.md   # the build refreshes it, and it is published

git commit -am "chore: release 0.3.0"
git tag v0.3.0       # the tag must match package.json, and CI checks that before publishing
git push origin main --follow-tags
```

The tag is what starts it. CI then runs the same checks a commit gets, and publishes only if they
pass — so a release cannot skip the tests that a pull request could not. Watch it under the
repository's Actions tab; if it fails after the tag is pushed, fix the cause, delete and re-push
the tag, or re-run the failed run from the Actions UI once the fix is tagged.

## Licence

MIT — see [LICENSE](LICENSE). The published file is a bundle, so the licences
of everything compiled into it travel with it in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
