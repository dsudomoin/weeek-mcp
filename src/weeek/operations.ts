import { WEEEK_OPERATIONS } from "../generated/weeek-openapi.ts";
import type { HttpMethod, WeeekOperation } from "../openapi-types.ts";

export function op(method: HttpMethod, path: string): WeeekOperation {
  const found = WEEEK_OPERATIONS.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (!found) {
    throw new Error(
      `The Weeek spec no longer has ${method} ${path}. ` +
        `Run "npm run update:openapi" and find out what changed in the API.`,
    );
  }
  return found;
}

export const OPS = {
  getProfile: op("GET", "/user/me"),
  getWorkspace: op("GET", "/ws"),
  getMembers: op("GET", "/ws/members"),
  getTags: op("GET", "/ws/tags"),
  getProjects: op("GET", "/tm/projects"),
  getBoards: op("GET", "/tm/boards"),
  getBoardColumns: op("GET", "/tm/board-columns"),
  searchTasks: op("GET", "/tm/tasks"),
  getTask: op("GET", "/tm/tasks/{id}"),
  createTask: op("POST", "/tm/tasks"),
  updateTask: op("PUT", "/tm/tasks/{id}"),
  changeBoard: op("POST", "/tm/tasks/{id}/board"),
  changeBoardColumn: op("POST", "/tm/tasks/{id}/board-column"),
  completeTask: op("POST", "/tm/tasks/{id}/complete"),
  unCompleteTask: op("POST", "/tm/tasks/{id}/un-complete"),
  addAssignees: op("POST", "/tm/tasks/{taskId}/assignees"),
  removeAssignees: op("DELETE", "/tm/tasks/{taskId}/assignees"),
  addWatchers: op("POST", "/tm/tasks/{task_id}/watchers"),
  removeWatchers: op("DELETE", "/tm/tasks/{task_id}/watchers"),
  listComments: op("GET", "/tm/tasks/{taskId}/comments"),
  createComment: op("POST", "/tm/tasks/{taskId}/comments"),
  deleteComment: op("DELETE", "/tm/tasks/{taskId}/comments/{commentId}"),
  uploadAttachment: op("POST", "/tm/tasks/{task_id}/attachments"),
  getAttachment: op("GET", "/ws/attachments/{file_id}"),
} as const;
