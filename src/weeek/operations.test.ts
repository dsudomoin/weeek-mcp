import { test } from "node:test";
import assert from "node:assert/strict";
import { OPS, op } from "./operations.ts";

test("the operations we depend on are still in the spec", () => {
  assert.equal(OPS.listComments.method, "GET");
  assert.equal(OPS.listComments.path, "/tm/tasks/{taskId}/comments");
  assert.equal(OPS.createComment.method, "POST");
  assert.equal(OPS.searchTasks.path, "/tm/tasks");
  assert.equal(OPS.changeBoardColumn.path, "/tm/tasks/{id}/board-column");
});

test("OPS exposes exactly the keys later modules import", () => {
  assert.deepEqual(Object.keys(OPS).sort(), [
    "addAssignees",
    "addWatchers",
    "changeBoard",
    "changeBoardColumn",
    "completeTask",
    "createComment",
    "createTask",
    "deleteComment",
    "getAttachment",
    "getBoardColumns",
    "getBoards",
    "getMembers",
    "getProfile",
    "getProjects",
    "getTags",
    "getTask",
    "getWorkspace",
    "listComments",
    "removeAssignees",
    "removeWatchers",
    "searchTasks",
    "unCompleteTask",
    "updateTask",
    "uploadAttachment",
  ]);
});

test("task search still has the filters we rely on", () => {
  const names = OPS.searchTasks.parameters.map((parameter) => parameter.name);
  for (const expected of ["projectId", "boardId", "search", "tags", "sortBy", "perPage", "offset"]) {
    assert.ok(names.includes(expected), `filter ${expected} is gone`);
  }
});

test("op throws when an endpoint disappeared from the spec", () => {
  assert.throws(() => op("GET", "/definitely-not-real"), /GET \/definitely-not-real/);
  assert.throws(() => op("GET", "/definitely-not-real"), /update:openapi/);
});
