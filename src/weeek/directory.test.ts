import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceDirectory, memberNameIn } from "./directory.ts";
import type { WeeekOperation } from "../openapi-types.ts";

type Call = { operation: WeeekOperation; options: unknown };

function stubClient(responses: Map<string, unknown>, calls: Call[] = []) {
  return {
    async request(operation: WeeekOperation, options: unknown = {}) {
      calls.push({ operation, options });
      // Answers a turn of the event loop later, the way a real request does. The concurrency tests
      // below do not need it — they dispatch every caller synchronously, so the in-flight window
      // cannot close early however fast this answers. It is here so that a load() which one day
      // awaits something before claiming the pending slot cannot pass by accident.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return responses.get(operation.path) ?? {};
    },
  };
}

// The fields beyond the ones Directory models are the ones the live API really sends, so that the
// projection can be shown to drop them. Weeek sends a project's title and name both, always
// identical, and no archived flag of any kind. The workspace's own extra fields are unverified.
function baseResponses(): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      "/user/me",
      {
        success: true,
        user: {
          id: "u-1",
          email: "denis@example.test",
          firstName: "Denis",
          lastName: "S",
          middleName: null,
          position: "dev",
          language: "ru",
        },
      },
    ],
    ["/ws", { success: true, workspace: { id: 1, title: "FunTime", logo: null } }],
    [
      "/ws/members",
      {
        success: true,
        members: [
          {
            id: "u-2",
            email: "anna@example.test",
            firstName: "Anna",
            lastName: "P",
            middleName: null,
            position: "qa",
            timeZone: "Europe/Moscow",
            roleType: "member",
          },
        ],
      },
    ],
    ["/ws/tags", { success: true, tags: [{ id: 51, title: "bug", color: "#ff0000" }] }],
    [
      "/tm/projects",
      {
        success: true,
        projects: [
          {
            id: 1,
            title: "Dev",
            name: "Dev",
            description: "everything we build",
            color: "blue",
            status: 1,
            isPrivate: false,
            team: [],
            customFields: [],
          },
        ],
      },
    ],
    ["/tm/boards", { success: true, boards: [{ id: 143, name: "Sprint 107", projectId: 1 }] }],
    ["/tm/board-columns", { success: true, boardColumns: [{ id: 802, name: "Done", boardId: 143 }] }],
  ]);
}

function queryOf(call: Call | undefined): unknown {
  return (call?.options as { query?: unknown } | undefined)?.query;
}

test("the base directory costs exactly five requests", async () => {
  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  const loaded = await directory.load();

  assert.equal(calls.length, 5);
  assert.equal(loaded.workspace.title, "FunTime");
  assert.equal(loaded.me.name, "Denis S");
  assert.equal(loaded.projects[0]?.name, "Dev");
});

test("a second call comes from the cache", async () => {
  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  await directory.load();
  await directory.load();

  assert.equal(calls.length, 5);
});

test("refresh drops the cache", async () => {
  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  await directory.load();
  await directory.load(true);

  assert.equal(calls.length, 10);
});

test("callers that arrive during a load share it", async () => {
  const direct: Call[] = [];
  const loaders = new WorkspaceDirectory(stubClient(baseResponses(), direct) as never);

  await Promise.all([loaders.load(), loaders.load(), loaders.load()]);
  assert.equal(direct.length, 5);

  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  // How a comment thread gets rendered: one lookup per author, all of them at once. Nothing is
  // cached until the first load resolves, so without sharing this costs five requests per author
  // instead of five in total.
  const authors = ["u-2", "u-1", "u-2", "u-2", "u-2"];
  const names = await Promise.all(
    authors.map(async (id) => memberNameIn(await directory.load())(id)),
  );

  assert.equal(calls.length, 5);
  assert.deepEqual(names, ["Anna P", "Denis S", "Anna P", "Anna P", "Anna P"]);
});

test("refresh does not join a load that started before it", async () => {
  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  // The refresh flag says the caller believes the data is stale, so handing them the load that
  // started before they said so would answer them with exactly what they asked us to discard.
  await Promise.all([directory.load(), directory.load(true)]);

  assert.equal(calls.length, 10);
});

test("a load that arrives after a refresh joins the refresh", async () => {
  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  // The other half of what refresh means: it does not join a load older than itself, but a plain
  // caller behind it wants the same fresh data and must not start a third load to get it.
  await Promise.all([directory.load(), directory.load(true), directory.load()]);

  assert.equal(calls.length, 10);
});

// The clock is pinned so that the load and the refresh start in the same millisecond, which is what
// two back-to-back calls out of one handler do on the real Date.now. A timestamp cannot order them.
test("a slow load does not overwrite the fresher refresh that overtook it", { timeout: 1000 }, async () => {
  const stale = baseResponses();
  const fresh = baseResponses();
  fresh.set("/ws", { success: true, workspace: { id: 1, title: "FunTime renamed" } });

  let openStale = () => {};
  const staleLanded = new Promise<void>((resolve) => {
    openStale = resolve;
  });

  let sent = 0;
  const client = {
    async request(operation: WeeekOperation) {
      sent += 1;
      // The first five requests belong to the first load, and they are held back so that the
      // refresh behind them comes home first.
      if (sent <= 5) {
        await staleLanded;
        return stale.get(operation.path) ?? {};
      }
      return fresh.get(operation.path) ?? {};
    },
  };

  const directory = new WorkspaceDirectory(client as never, () => 0);

  const slow = directory.load();
  assert.equal((await directory.load(true)).workspace.title, "FunTime renamed");

  openStale();
  await slow;

  assert.equal((await directory.load()).workspace.title, "FunTime renamed");
  assert.equal(sent, 10);
});

test("a refresh inside the same millisecond still lands in the cache", async () => {
  const responses = baseResponses();
  const directory = new WorkspaceDirectory(stubClient(responses) as never, () => 0);

  await directory.load();
  responses.set("/ws", { success: true, workspace: { id: 1, title: "FunTime renamed" } });
  await directory.load(true);

  // The sequential half of the same tie. Ordering loads by timestamp cannot serve both this and
  // the concurrent case above: one of the two comparisons has to lose when the clock does not move.
  assert.equal((await directory.load()).workspace.title, "FunTime renamed");
});

test("a failed load is not kept and blocks nothing after it", async () => {
  const calls: Call[] = [];
  const responses = baseResponses();
  let broken = true;
  const client = {
    async request(operation: WeeekOperation, options: unknown = {}) {
      calls.push({ operation, options });
      if (broken) throw new Error("weeek is down");
      return responses.get(operation.path) ?? {};
    },
  };
  const directory = new WorkspaceDirectory(client as never);

  await assert.rejects(() => directory.load(), /weeek is down/);
  assert.equal(calls.length, 5);

  broken = false;
  const loaded = await directory.load();

  assert.equal(loaded.workspace.title, "FunTime");
  assert.equal(calls.length, 10);
});

test("a caller joining a failed load fails with it", { timeout: 1000 }, async () => {
  const calls: Call[] = [];
  const responses = baseResponses();
  let broken = true;
  const client = {
    async request(operation: WeeekOperation, options: unknown = {}) {
      calls.push({ operation, options });
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (broken) throw new Error("weeek is down");
      return responses.get(operation.path) ?? {};
    },
  };
  const directory = new WorkspaceDirectory(client as never);

  const first = directory.load();
  const joiner = directory.load();
  const outcomes = await Promise.allSettled([first, joiner]);

  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ["rejected", "rejected"],
  );
  assert.equal(calls.length, 5);

  broken = false;
  assert.equal((await directory.load()).workspace.title, "FunTime");
  assert.equal(calls.length, 10);
});

test("the directory carries only the fields it promises", async () => {
  const directory = new WorkspaceDirectory(stubClient(baseResponses()) as never);

  const loaded = await directory.load();

  // This is what a tool hands the model, so anything Weeek sends and we do not model is context
  // the caller pays for and cannot use.
  assert.deepEqual(loaded.me, { id: "u-1", name: "Denis S", position: "dev" });
  assert.deepEqual(loaded.workspace, { id: 1, title: "FunTime" });
  assert.deepEqual(loaded.members, [{ id: "u-2", name: "Anna P", position: "qa" }]);
  assert.deepEqual(loaded.tags, [{ id: 51, title: "bug" }]);
  assert.deepEqual(loaded.projects, [{ id: 1, name: "Dev" }]);

  // Boards and columns are handed to the same caller through the same tool, so they are projected
  // on the same terms even though they are fetched a level lower down.
  assert.deepEqual(await directory.boards(1), [{ id: 143, name: "Sprint 107" }]);
  assert.deepEqual(await directory.columns(143), [{ id: 802, name: "Done" }]);
});

test("a member with no name at all falls back to the id", async () => {
  const responses = baseResponses();
  responses.set("/ws/members", {
    success: true,
    members: [{ id: "u-3", firstName: null, lastName: null, position: null }],
  });
  const directory = new WorkspaceDirectory(stubClient(responses) as never);

  assert.deepEqual((await directory.load()).members, [
    { id: "u-3", name: "u-3", position: null },
  ]);
  assert.equal(memberNameIn(await directory.load())("u-3"), "u-3");
});

test("the cache expires once its lifetime is up", async () => {
  const calls: Call[] = [];
  let clock = 0;
  const directory = new WorkspaceDirectory(
    stubClient(baseResponses(), calls) as never,
    () => clock,
  );

  await directory.load();

  clock = 5 * 60 * 1000 - 1;
  await directory.load();
  assert.equal(calls.length, 5);

  clock = 5 * 60 * 1000;
  await directory.load();
  assert.equal(calls.length, 10);
});

test("boards are requested per project only", async () => {
  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  const boards = await directory.boards(1);

  assert.equal(boards[0]?.name, "Sprint 107");
  // One request, not six: boards must not drag the whole directory in behind them.
  assert.equal(calls.length, 1);
  assert.deepEqual(queryOf(calls.find((call) => call.operation.path === "/tm/boards")), {
    projectId: 1,
  });
});

test("columns are requested per board only", async () => {
  const calls: Call[] = [];
  const directory = new WorkspaceDirectory(stubClient(baseResponses(), calls) as never);

  const columns = await directory.columns(143);

  assert.equal(columns[0]?.name, "Done");
  assert.equal(calls.length, 1);
  assert.deepEqual(queryOf(calls.find((call) => call.operation.path === "/tm/board-columns")), {
    boardId: 143,
  });
});

test("a member id resolves to a name, including our own", async () => {
  const directory = await new WorkspaceDirectory(stubClient(baseResponses()) as never).load();

  assert.equal(memberNameIn(directory)("u-2"), "Anna P");
  assert.equal(memberNameIn(directory)("u-1"), "Denis S");
});

test("a loaded directory names ids with no request of its own", async () => {
  // renderCommentTree and toTaskRow both name an id while they are building a line, so neither can
  // await anything. This is that lookup, over a snapshot already loaded.
  const directory = await new WorkspaceDirectory(stubClient(baseResponses()) as never).load();

  const name = memberNameIn(directory);

  assert.equal(name("u-2"), "Anna P");
  assert.equal(name("u-1"), "Denis S");
  assert.equal(name("no-such-id"), "no-such-id");
});

test("a member id resolves from the members list ahead of the profile", async () => {
  // Live, both sources carry the same person from the same fields, so the two names differ here
  // only to make the precedence visible at all. It is pinned because extracting memberNameIn
  // flipped it — the old method read the profile first — and the fixture could not see the flip:
  // it holds only u-2, while the id every other test asks about is u-1. Overridden locally rather
  // than in baseResponses so the five expectations built on "Denis S" stay readable.
  const responses = baseResponses();
  responses.set("/ws/members", {
    success: true,
    members: [{ id: "u-1", firstName: "Denis", lastName: "from-members" }],
  });
  const workspace = new WorkspaceDirectory(stubClient(responses) as never);

  assert.equal(memberNameIn(await workspace.load())("u-1"), "Denis from-members");
});

test("an unknown member does not break the output", async () => {
  const directory = await new WorkspaceDirectory(stubClient(baseResponses()) as never).load();
  assert.equal(memberNameIn(directory)("no-such-id"), "no-such-id");
});

test("tags resolve to titles", async () => {
  const directory = new WorkspaceDirectory(stubClient(baseResponses()) as never);
  assert.deepEqual(await directory.tagTitles([51, 99]), ["bug", "99"]);
});
