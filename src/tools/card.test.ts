import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawTask } from "../format/tasks.ts";
import { connectedServer, payloadOf, toolContext } from "../testing/tools.ts";
import { renderCard } from "./card.ts";

/**
 * A task with every field Weeek actually answers with, and nothing invented.
 *
 * The forty-one keys are the ones a live workspace returned, in that spelling — the generated spec
 * declares almost none of them, so the shape can only come from the wire. The values are made up;
 * the key set is not, and it is the key set that this file is about. A field Weeek adds later will
 * not appear here, which is why the assertion below names what the card keeps rather than what it
 * drops: an unknown field is dropped by construction now that nothing is spread.
 */
function wireTask(overrides: Record<string, unknown> = {}): RawTask {
  return {
    id: 7197,
    parentId: null,
    title: "Vampirism",
    description: "<p>ship it</p>",
    overdue: 0,
    duration: null,
    type: "action",
    priority: 2,
    isCompleted: false,
    isDeleted: false,
    authorId: "u-me",
    userId: "u-2",
    assignees: ["u-2"],
    projectId: 9,
    boardId: 53,
    boardColumnId: 302,
    locations: [{ projectId: 9, boardId: 53, boardColumnId: 302 }],
    image: null,
    isPrivate: false,
    date: null,
    time: null,
    dateStart: null,
    dateEnd: null,
    timeStart: null,
    timeEnd: null,
    startDate: null,
    startDateTime: null,
    dueDate: null,
    dueDateTime: null,
    createdAt: "2026-08-30T11:23:58Z",
    updatedAt: "2026-08-30T11:26:36Z",
    completedAt: null,
    repeat: null,
    tags: [51],
    subscribers: ["u-me", "u-2"],
    subTasks: [],
    workloads: [],
    timeEntries: [],
    timer: null,
    customFields: [
      { id: "cf-1", name: null, type: "select", options: [], value: null },
      { id: "cf-2", name: null, type: "member", value: [] },
    ],
    attachments: [],
    ...overrides,
  };
}

/** Exactly what a card carries. Written out so that adding or losing a field is a deliberate act. */
const CARD_KEYS = [
  "id",
  "title",
  "description",
  "type",
  "priority",
  "priorityLabel",
  "isCompleted",
  "isDeleted",
  "isPrivate",
  "overdue",
  "parentId",
  "subTasks",
  "projectId",
  "boardId",
  "boardColumnId",
  "locations",
  "assignees",
  "assigneeNames",
  "subscribers",
  "authorId",
  "tags",
  "tagTitles",
  "startDate",
  "startDateTime",
  "dueDate",
  "dueDateTime",
  "duration",
  "repeat",
  "createdAt",
  "updatedAt",
  "completedAt",
  "attachments",
  "customFields",
];

async function card(task: RawTask = wireTask()): Promise<Record<string, unknown>> {
  return renderCard(task, toolContext().directory);
}

test("the card carries exactly the fields it means to, and Weeek's noise is not among them", async () => {
  assert.deepEqual(Object.keys(await card()).sort(), [...CARD_KEYS].sort());
});

test("the fields dropped from the wire are the ones nothing can use", async () => {
  const rendered = await card();

  // userId is assignees[0] on every task it was compared against; the time-tracking trio and the
  // calendar-event dates were empty on all 220 measured, and this server writes none of them.
  for (const dropped of [
    "userId",
    "image",
    "date",
    "time",
    "dateStart",
    "dateEnd",
    "timeStart",
    "timeEnd",
    "workloads",
    "timeEntries",
    "timer",
  ]) {
    assert.ok(!(dropped in rendered), `${dropped} is still on the card`);
  }
});

test("the fields an empty task makes look like noise are kept anyway", async () => {
  const rendered = await card();

  // Each of these is null or empty on a fresh task and each carries meaning when it is not:
  // subTasks is the only place a task's children appear, repeat is what says completing this task
  // will spawn another, and the two dates are what weeek_update_task writes.
  for (const kept of ["subTasks", "repeat", "startDate", "dueDate", "duration", "subscribers"]) {
    assert.ok(kept in rendered, `${kept} was dropped`);
  }
  // Watchers, and the read-back for weeek_set_task_people. Not an echo of authorId.
  assert.deepEqual(rendered["subscribers"], ["u-me", "u-2"]);
});

test("an attachment keeps what a model can act on and loses the link it cannot", async () => {
  const rendered = await card(
    wireTask({
      attachments: [
        {
          id: "a2a0314b",
          creatorId: "u-2",
          service: "weeek",
          name: "image.png",
          url: "https://api.weeek.net/ws/1/files/a2a0314b?expires=1788093283&signature=0b2ebc5d",
          createdAt: "2026-08-30T11:24:15+00:00",
          size: 57417,
        },
      ],
    }),
  );

  // The id is what weeek_get_attachment takes, and the signed url — the largest field on a card
  // with files on it — is the one thing here a model cannot use and that stops working anyway.
  assert.deepEqual(rendered["attachments"], [
    {
      id: "a2a0314b",
      name: "image.png",
      size: 57417,
      createdAt: "2026-08-30T11:24:15+00:00",
      creatorId: "u-2",
    },
  ]);
});

test("a custom field appears once it has a value, and not before", async () => {
  assert.deepEqual((await card())["customFields"], []);

  const filled = await card(
    wireTask({
      customFields: [
        { id: "cf-1", name: "Severity", type: "select", value: "high" },
        { id: "cf-2", name: null, type: "member", value: [] },
        { id: "cf-3", name: null, type: "text", value: null },
      ],
    }),
  );

  // The unset member list and the unset select are both empty; only the one somebody filled in is
  // real data, and a workspace that uses custom fields keeps it visible.
  assert.deepEqual(filled["customFields"], [
    { id: "cf-1", name: "Severity", type: "select", value: "high" },
  ]);
});

test("the resolved names sit beside the raw ids rather than replacing them", async () => {
  const rendered = await card();

  // weeek_set_task_people takes ids, so a card that answered only with names would be unusable as
  // the thing a model reads before reassigning someone.
  assert.deepEqual(rendered["assignees"], ["u-2"]);
  assert.deepEqual(rendered["assigneeNames"], ["Anna K"]);
  assert.deepEqual(rendered["tags"], [51]);
  assert.deepEqual(rendered["tagTitles"], ["bug"]);
  assert.equal(rendered["priority"], 2);
  assert.equal(rendered["priorityLabel"], "high");
  // Weeek stores HTML; a model reads markdown.
  assert.equal(rendered["description"], "ship it");
});

test("reading, creating and updating a task all answer with the same card", async () => {
  // The three share renderCard so that they cannot disagree, and this is what says so out loud:
  // curating the card had to move all three at once or leave two of them passing the payload
  // through. Every answer is compared on the card's own keys, since each tool adds its own
  // outcome flag on top.
  const task = wireTask();
  const server = await connectedServer(
    toolContext({
      "/tm/tasks/{id}": { success: true, task },
      "/tm/tasks": { success: true, task },
      "/tm/tasks/{taskId}/comments": { success: true, comments: [], hasMore: false },
    }),
  );

  const answers = await Promise.all([
    server.call("weeek_get_task", { taskId: 7197 }),
    server.call("weeek_create_task", { title: "Vampirism", projectId: 9 }),
    server.call("weeek_update_task", { taskId: 7197, title: "Vampirism" }),
  ]);
  await server.close();

  for (const answer of answers) {
    const carried = Object.keys(payloadOf(answer)).filter((key) => CARD_KEYS.includes(key));
    assert.deepEqual(carried.sort(), [...CARD_KEYS].sort());
  }
});
