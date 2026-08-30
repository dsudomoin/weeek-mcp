import type { WeeekClient } from "../http/client.ts";
import { unwrapEnvelope } from "../http/quirks.ts";
import { OPS } from "./operations.ts";

export type Member = { id: string; name: string; position: string | null };
// Weeek answers with both `title` and `name`, identical in every project, so only `name` is kept
// and a project reads like a board. There is no archived flag to keep either: `status` is 1 even
// for the projects whose name ends in "(Archive)".
export type Project = { id: number; name: string };
export type Board = { id: number; name: string };
export type BoardColumn = { id: number; name: string };
export type Tag = { id: number; title: string };

export type Directory = {
  me: Member;
  workspace: { id: number; title: string };
  projects: Project[];
  members: Member[];
  tags: Tag[];
};

// Weeek sends far more than this on every one of these: a project alone has eleven fields. Only
// what Directory declares is read out of them, so nothing else reaches a caller by accident.
type RawUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  position?: string | null;
};

type RawWorkspace = { id: number; title: string };
type RawProject = { id: number; name: string };
type RawTag = { id: number; title: string };
type RawBoard = { id: number; name: string };
type RawBoardColumn = { id: number; name: string };

// A workspace gains a member or a project on a human timescale, so minutes of staleness cost
// nothing, while rebuilding the directory for every tool call would cost five requests every time.
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Answers what the workspace contains, so that everything above can turn an id into a name.
 *
 * Boards and columns are deliberately left out of the loaded directory. `GET /tm/boards` needs a
 * projectId and `GET /tm/board-columns` needs a boardId — the latter despite the spec calling it
 * optional, since without it the API answers 422. The real workspace has 5 projects and 110 boards,
 * so a directory that held them all would cost 119 requests to build.
 */
export class WorkspaceDirectory {
  readonly #client: WeeekClient;
  readonly #now: () => number;
  #cache: { value: Directory; loadedAt: number; sequence: number } | undefined;
  #pending: Promise<Directory> | undefined;
  #sequence = 0;

  // Parameter properties are TypeScript-only syntax and node strips types rather than compiling
  // them, so the fields are declared and assigned by hand.
  constructor(client: WeeekClient, now: () => number = Date.now) {
    this.#client = client;
    this.#now = now;
  }

  async load(refresh = false): Promise<Directory> {
    const cached = this.#cache;
    if (!refresh && cached && this.#now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.value;
    }

    // Nothing is cached until the first load resolves, so without this every caller arriving while
    // one is in flight starts five requests of its own, and rendering a comment thread fetches the
    // whole directory once per author. A refresh does not join: it says the caller believes the
    // data is stale, and this load started before they said so.
    if (!refresh && this.#pending !== undefined) return this.#pending;

    // Loads are ordered by a counter rather than by the clock. Two started in the same millisecond
    // are indistinguishable by timestamp, and that is precisely when it happens: a refresh issued
    // right behind a load shares its millisecond, so either comparison loses one of the two cases —
    // `<=` lets the older load overwrite the refresh that overtook it, `<` makes a refresh throw
    // away the fresh data it just fetched. The clock stays for the TTL, which is all it can do.
    const sequence = (this.#sequence += 1);
    // Stamped from the start of the load, since that is when the data was true.
    const startedAt = this.#now();
    const pending = this.#fetchAll();
    this.#pending = pending;

    try {
      const value = await pending;
      // Whichever load started last wins, however the two responses were ordered coming back.
      if (this.#cache === undefined || this.#cache.sequence < sequence) {
        this.#cache = { value, loadedAt: startedAt, sequence };
      }
      return value;
    } finally {
      // Cleared on failure too: a load nobody can await again would turn one bad minute at Weeek
      // into a directory that never loads. A refresh may have replaced it, and that one clears
      // itself, so only the load that put this promise there takes it away.
      if (this.#pending === pending) this.#pending = undefined;
    }
  }

  async #fetchAll(): Promise<Directory> {
    // Five independent endpoints, so they go out together rather than one after another.
    const [profile, workspace, members, tags, projects] = await Promise.all([
      this.#client.request(OPS.getProfile),
      this.#client.request(OPS.getWorkspace),
      this.#client.request(OPS.getMembers),
      this.#client.request(OPS.getTags),
      this.#client.request(OPS.getProjects),
    ]);

    const workspaceValue = unwrapEnvelope<RawWorkspace>(workspace, "workspace");

    return {
      me: toMember(unwrapEnvelope<RawUser>(profile, "user")),
      workspace: { id: workspaceValue.id, title: workspaceValue.title },
      members: unwrapEnvelope<RawUser[]>(members, "members").map(toMember),
      tags: unwrapEnvelope<RawTag[]>(tags, "tags").map(toTag),
      projects: unwrapEnvelope<RawProject[]>(projects, "projects").map(toProject),
    };
  }

  async boards(projectId: number): Promise<Board[]> {
    const payload = await this.#client.request(OPS.getBoards, { query: { projectId } });
    return unwrapEnvelope<RawBoard[]>(payload, "boards").map(toBoard);
  }

  async columns(boardId: number): Promise<BoardColumn[]> {
    const payload = await this.#client.request(OPS.getBoardColumns, { query: { boardId } });
    return unwrapEnvelope<RawBoardColumn[]>(payload, "boardColumns").map(toBoardColumn);
  }

  async tagTitles(ids: readonly number[]): Promise<string[]> {
    const directory = await this.load();
    return ids.map((id) => directory.tags.find((tag) => tag.id === id)?.title ?? String(id));
  }
}

/**
 * Names a member id, over a snapshot already in hand.
 *
 * `renderCommentTree` and `toTaskRow` both name an id in the middle of building a line, so neither
 * can await anything, and both were carrying a copy of these three lines. An id nobody can name
 * stays the id: every tool still takes it as input, so it is an incomplete answer, not a wrong one.
 *
 * A `WorkspaceDirectory` method that awaited the load and called this used to sit beside it. It
 * had no caller outside the tests, which is what kept it looking alive.
 */
export function memberNameIn(directory: Directory): (id: string) => string {
  return (id) =>
    directory.members.find((member) => member.id === id)?.name ??
    (directory.me.id === id ? directory.me.name : id);
}

function toMember(user: RawUser): Member {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return { id: user.id, name: name === "" ? user.id : name, position: user.position ?? null };
}

function toProject(project: RawProject): Project {
  return { id: project.id, name: project.name };
}

function toTag(tag: RawTag): Tag {
  return { id: tag.id, title: tag.title };
}

function toBoard(board: RawBoard): Board {
  return { id: board.id, name: board.name };
}

function toBoardColumn(column: RawBoardColumn): BoardColumn {
  return { id: column.id, name: column.name };
}
