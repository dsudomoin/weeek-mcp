import { type RawTask, priorityLabel, taskDescriptionMarkdown } from "../format/tasks.ts";
import { asRecord } from "../http/quirks.ts";
import { type WorkspaceDirectory, memberNameIn } from "../weeek/directory.ts";

/**
 * The attachments of a task, as much of each as a model can act on.
 *
 * `url` is dropped, and it is the reason this function exists: it is a pre-signed link carrying
 * `expires` and `signature` query parameters, some 150 characters of them per file, and it is the
 * single largest thing on a card that has attachments. A model cannot fetch a URL, and the way it
 * reaches these bytes is weeek_get_attachment, which takes the `id` kept here and asks Weeek for a
 * fresh link of its own. So the field costs the most and is the one thing here nobody can use —
 * and it expires, which makes handing it over actively misleading rather than merely wasteful.
 *
 * `service` goes for a duller reason: every attachment in the workspace this was measured against
 * reads `"weeek"`, and it names the storage backend rather than anything about the file.
 */
function renderAttachments(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const file = asRecord(entry);
    if (file === undefined) return [];
    return [
      {
        id: file["id"],
        name: file["name"],
        size: file["size"],
        createdAt: file["createdAt"],
        creatorId: file["creatorId"],
      },
    ];
  });
}

/**
 * The custom fields that have been filled in, and only those.
 *
 * Weeek answers with every custom field the workspace defines on every task, whether or not the
 * task uses one — measured at 202 characters per card in a workspace where not a single task, out
 * of 220, has a value in any of them. That is the largest steady cost on a card and it carries no
 * information at all: the entries read `"name": null, "value": null`.
 *
 * The field is still always present rather than dropped outright, because a workspace that does
 * use custom fields keeps real data here and a model reading a task should see it. What varies is
 * how many entries it holds, which is the same way `assignees` and `tags` behave — not a field
 * that appears and disappears from the shape.
 */
function filledCustomFields(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry) => {
    const field = asRecord(entry);
    if (field === undefined) return false;
    const filled = field["value"];
    // An unset select answers null and an unset member list answers [], so both spellings of
    // "nobody filled this in" have to count as empty.
    return filled !== null && filled !== undefined && !(Array.isArray(filled) && filled.length === 0);
  });
}

/**
 * A task card as a model should read it, wherever the card came from.
 *
 * One function because there is one right answer to "what does a task look like", and two copies of
 * it drifted: the read tool resolved priorities, tags and assignees to names while the mutation
 * tools echoed the raw ids. The drift landed worst on weeek_update_task, which is the one call that
 * **replaces the whole tag list** — so the tool with this project's most destructive trap was the
 * one whose answer could not be read back to confirm what it had just done. weeek_get_task,
 * weeek_create_task and weeek_update_task all answer with this, so they cannot disagree.
 *
 * **Every field is named rather than spread**, which is the change this function most recently
 * underwent and the reason it is worth reading before adding anything. It used to spread `...task`,
 * which made it the one tool on this server that passed Weeek's payload through untouched — about
 * 1 400 characters for a task with nothing in it, most of them empty. Naming the fields is what
 * `toTaskRow` already does for a search row, and for the same reason: a wire field cannot ride
 * along unnoticed, and the shape does not change from one call to the next.
 *
 * What was dropped, and why each one is safe to lose:
 *
 * - `userId` — it is `assignees[0]`, on all 100 tasks it was compared against and with no
 *   exception. `assignees` is kept, resolved to names beside it, so nothing here is unreachable.
 * - `date`, `time`, `dateStart`, `dateEnd`, `timeStart`, `timeEnd` — a calendar-event model this
 *   server never writes and Weeek never filled: null on all 220 tasks measured. The dates that do
 *   carry meaning — `startDate`, `dueDate`, `duration`, and the three timestamps — are all kept,
 *   and the first three are exactly what weeek_update_task can set, so a model can still read back
 *   what it just wrote.
 * - `workloads`, `timeEntries`, `timer` — the time-tracking product. Nothing in this server reads
 *   or writes them, and they were empty on all 220.
 * - `image` — a cover image for Weeek's own board view. Presentation, and a model cannot see it.
 *
 * What was deliberately kept, though a glance at one empty task would call it noise:
 *
 * - `subTasks` — empty on most tasks but not on all, and when it is not, it is the only place the
 *   children of a task appear. `parentId` is the same relation read the other way and is kept too.
 * - `repeat` — always null in the workspace measured, and still meaningful: weeek_complete_task
 *   documents that completing a recurring task makes Weeek create the next occurrence, and this is
 *   the field that says a task is one of those before the surprise arrives.
 * - `subscribers` — the watchers, and that reading is an inference from the data rather than
 *   anything the spec states; see the note at the field. It differs from `[authorId]` on 49 of 100
 *   tasks, so it is a real list rather than an echo, and on that reading it is the read-back for
 *   weeek_set_task_people's watcher half. Dropping it would leave that tool unable to confirm its
 *   own work, which is the exact fault the first paragraph describes — and it is kept whatever the
 *   field turns out to be, since keeping is the safe direction for a field nobody can name.
 * - `startDateTime`, `dueDateTime` — null everywhere measured, and kept anyway. They are the
 *   time-of-day halves of two dates that are kept and written, and this server writes dates only
 *   as `YYYY-MM-DD`; a time set from Weeek's own interface would live here and nowhere else. Cheap
 *   insurance against a loss that would be silent.
 *
 * The resolved fields sit beside the raw ones and never instead of them: this is the card a model
 * reads before reassigning someone, and weeek_set_task_people takes the ids.
 */
export async function renderCard(
  task: RawTask,
  directory: WorkspaceDirectory,
): Promise<Record<string, unknown>> {
  const rawTags = task["tags"];
  const tagIds = Array.isArray(rawTags)
    ? rawTags.filter((id: unknown): id is number => typeof id === "number")
    : [];

  const rawAssignees = task["assignees"];
  const assignees = Array.isArray(rawAssignees)
    ? rawAssignees.filter((id: unknown): id is string => typeof id === "string")
    : [];
  // Together rather than in series, though it costs nothing either way: tagTitles awaits the same
  // load internally and WorkspaceDirectory de-duplicates concurrent loads, so the sequential form
  // would make the same one request. Written this way because neither needs the other.
  const [tagTitles, loaded] = await Promise.all([directory.tagTitles(tagIds), directory.load()]);
  const nameOf = memberNameIn(loaded);

  return {
    id: task.id,
    title: task.title,
    // Weeek stores a description as HTML. Without this a model that wrote markdown gets Weeek's
    // HTML echoed back as though that were what it had sent.
    description: taskDescriptionMarkdown(task),
    type: task["type"],
    priority: task["priority"],
    priorityLabel: priorityLabel(task["priority"]),
    isCompleted: task["isCompleted"],
    isDeleted: task["isDeleted"],
    isPrivate: task["isPrivate"],
    overdue: task["overdue"],
    parentId: task["parentId"],
    subTasks: task["subTasks"] ?? [],
    projectId: task["projectId"],
    boardId: task["boardId"],
    boardColumnId: task["boardColumnId"],
    // The three above are the primary location; this is every place the task is filed, which is
    // more than one when someone has used POST /tm/tasks/{task_id}/locations. toTaskRow leaves it
    // out and says that the card is where to find it, so this is that promise.
    locations: task["locations"] ?? [],
    // The wire's own list, not the filtered one the names are built from. Curating this card is
    // about which fields it carries, not about quietly editing the contents of one: an id of an
    // unexpected shape stays visible here rather than vanishing on its way to the model.
    assignees: rawAssignees ?? [],
    // Not a positional pair with `assignees` — anything the filter above drops is absent here and
    // still present there — so an id has to be read from `assignees`, never from this index.
    //
    // Called rather than passed to map: a resolver that ever grew a second parameter loose enough
    // to accept a number would silently be handed the row index and still compile.
    assigneeNames: assignees.map((id) => nameOf(id)),
    // Inferred to be the watcher list, not documented as one: the spec describes no response body
    // for this endpoint, the write side spells it `watchers` on /tm/tasks/{task_id}/watchers, and
    // the only evidence tying them together is that this holds people who are not the author on 49
    // of 100 live tasks and nothing else could. Verify here first if watchers ever read wrong.
    subscribers: task["subscribers"] ?? [],
    authorId: task["authorId"],
    tags: rawTags ?? [],
    tagTitles,
    startDate: task["startDate"],
    startDateTime: task["startDateTime"],
    dueDate: task["dueDate"],
    dueDateTime: task["dueDateTime"],
    duration: task["duration"],
    repeat: task["repeat"],
    createdAt: task["createdAt"],
    updatedAt: task["updatedAt"],
    completedAt: task["completedAt"],
    attachments: renderAttachments(task["attachments"]),
    customFields: filledCustomFields(task["customFields"]),
  };
}
