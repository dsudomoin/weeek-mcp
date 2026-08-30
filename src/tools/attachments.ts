import { mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { unwrapEnvelope } from "../http/quirks.ts";
import { OPS } from "../weeek/operations.ts";
import {
  WRITE_ANNOTATIONS,
  type ToolContext,
  asRecord,
  guard,
  jsonResult,
  nullAsAbsent,
  weeekId,
} from "./shared.ts";

/**
 * How long a download may take before it is given up on.
 *
 * A ceiling on a socket that has stopped answering, not a budget for a large file: nothing else
 * bounds the body read, so without it a stalled connection leaves the tool pending forever and the
 * handler with it. Twice the client's own 30 s, because this is a file coming off a storage host
 * rather than a JSON call to an API, and far more than the screenshot an attachment nearly always
 * turns out to be. The largest file Weeek stores, 100 MB, needs about 13 Mbit/s to arrive inside
 * it — on a slower link than that this constant is the thing that is wrong, and it is where to
 * say so.
 *
 * Not `config.timeoutMs`, and not plumbed through ToolContext, which carries no config: one
 * timeout is not worth that coupling.
 */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * The largest file that will be held in memory, in either direction.
 *
 * Weeek's own limit rather than an invented one — the spec states "Max file size is 100MB" on the
 * `files[]` field, so nothing larger is stored and nothing larger can come back down either. Both
 * tools buffer the whole file: the upload reads it before any of it is sent, the download collects
 * the body before any of it is written. Past this size that buffer is itself the damage — a
 * long-lived server holding gigabytes, and on the way up the whole transfer spent to be refused at
 * the end. It is also the one input in this server whose size the model neither chooses nor sees.
 *
 * Whether Weeek reads "100MB" as 10^8 or as 2^20 × 100 is its own business. This takes the larger
 * reading, so that the guard can only ever refuse a file Weeek would have refused too; right at
 * the boundary Weeek is the authority and answers for itself.
 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Whether a real path is the root or sits under it.
 *
 * Both sides must already have been through realpath. Comparing unresolved paths would make this a
 * string game: a symlink inside the root pointing anywhere would pass, which is the whole trick
 * this is here to stop. The separator matters — without it /srv/workspace-other would count as
 * inside /srv/workspace.
 *
 * `root + sep` is safe because config.ts refuses a root that is already a filesystem root, which is
 * the only shape that would double the separator and leave nothing underneath. That refusal is
 * written as `parse(x).root === x` rather than against `sep`, so it holds for `C:\` and a UNC
 * share root as well.
 */
function isInsideRoot(root: string, resolved: string): boolean {
  return resolved === root || resolved.startsWith(root + sep);
}

/**
 * The refusals, worded for the reader who will actually see them: a model deciding what to do next.
 *
 * Both say the same thing in different words — this is a rule of the server, not a mistake in the
 * call — because the difference decides what a model does with it. Read as a bad argument, a
 * refusal invites another path and another attempt, which is exactly the behaviour an injected
 * instruction is trying to produce. Read as a rule, there is nothing to retry.
 */
function noRoot(action: string, extra = ""): Error {
  return new Error(
    `WEEEK_FILE_ROOT is not set, so this server will not ${action}. This is a rule of the server, ` +
      `not a fault in the call, and no other path will work either: the operator has to name a ` +
      `directory in WEEEK_FILE_ROOT first.${extra}`,
  );
}

function outsideRoot(path: string, root: string, action: string): Error {
  return new Error(
    `${path} is outside ${root}, the only directory this server may ${action}. This is a rule of ` +
      "the server, not a fault in the call — another path outside that directory will be refused " +
      "in the same way.",
  );
}

/**
 * Adds the wide-root warning to an answer, when there is one to add.
 *
 * It is repeated on every call rather than kept once per session, and that is the point: stderr
 * from a stdio server is the channel a person is least likely to be reading — Claude Code files it
 * into a log — so the only place a warning reliably reaches somebody is the transcript. Repetition
 * costs a sentence to the one operator running the widest possible configuration, and that is the
 * right party to pay it. No state, because state is how "shown once" becomes "shown never".
 */
function withWarning(
  answer: Record<string, unknown>,
  warning: string | null,
): Record<string, unknown> {
  return warning === null ? answer : { ...answer, warning };
}

/** The real path, or null when there is nothing there. Used where absence is an ordinary answer. */
async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** The three fields this tool reads. Weeek sends id, createdAt, creatorId and service too. */
type AttachmentMeta = { name?: unknown; url?: unknown; size?: unknown };

/**
 * A size a model can read and a size it can compare.
 *
 * Both, because either alone fails at the only place this text matters. Megabytes alone renders a
 * file one byte over the limit as "100.0 MB, and at most 100.0 MB" — a sentence that reads as a
 * contradiction exactly where it is supposed to say how far over the file is. Bytes alone are
 * exact and unreadable at this magnitude.
 */
function fileSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB (${bytes} bytes)`;
}

/**
 * The files Weeek says it stored, or null when it answered without them.
 *
 * `data` is an array. The generated spec declares it as a single `$ref` to Attachment and the live
 * body is a list — the fourth response this spec has misdescribed on this project, and the reason
 * a projection written from the schema rather than from the wire would have been wrong here.
 *
 * Null rather than a throw when it is anything else, for the reason `answeredComment` gives: an
 * upload that landed and is reported as failed gets sent again, and the task ends up carrying the
 * same file twice.
 *
 * "Anything else" is judged on what survives the projection, not on what arrived. A list that is
 * empty and a list whose every entry is unreadable — `{"data": [null]}` — describe the same
 * nothing, and the second one reaches this function as a non-empty array. Both have to answer null
 * here, or the tool returns `attachments: []`: a success that names nothing, which is the one
 * answer a model cannot tell from a real one.
 */
function answeredFiles(payload: unknown): Record<string, unknown>[] | null {
  const data = asRecord(payload)?.["data"];
  if (!Array.isArray(data)) return null;

  // id, name and size, and nothing else. creatorId and service say nothing a model can act on,
  // and `url` is a presigned link of some 180 characters that expires within the hour — spending
  // that on every upload, for a thing weeek_get_attachment fetches fresh when it is actually
  // needed, is exactly the kind of payload this project's answers are trimmed of.
  const files = data.flatMap((entry: unknown) => {
    const file = asRecord(entry);
    return file === undefined ? [] : [{ id: file["id"], name: file["name"], size: file["size"] }];
  });

  return files.length === 0 ? null : files;
}

/**
 * Reduces a name Weeek gave us to something that can only ever name a file inside the folder it
 * is joined to.
 *
 * The name is not ours: it is whatever the person who uploaded the file called it, echoed back by
 * the API, and it goes straight into a path on this machine. `basename` is what does the work —
 * whatever it returns holds no separator, so a joined path cannot climb out of its folder. It is
 * also the platform's own: on Windows it strips `\` and a drive letter too, which the POSIX one
 * would leave in place as ordinary characters of a filename.
 *
 * That leaves two results `basename` can return which are still not names: the empty string, and
 * a run of dots. `..` joined to a folder is its parent, and `.` is the folder itself — neither
 * writes the file that was asked for, and the first writes somewhere else entirely.
 *
 * A leading dot survives all of that and is its own problem. A file called `.envrc` is run by
 * direnv at the next `cd`; `.zshenv` and `.gitconfig` are read by their own programs the same way.
 * The dot is what makes a filename mean something to a tool rather than to a person, and that is
 * true whoever supplied the name — which is why this runs on the path a caller names as well as on
 * the one Weeek reports. It is prefixed rather than rejected: the name stays legible, and nothing
 * legitimate is lost.
 */
export function safeFileName(name: string): string {
  const base = basename(name.trim()).replace(/^\.+$/, "");
  if (base === "") return "attachment";
  return base.startsWith(".") ? `attachment-${base}` : base;
}

/** True only for something that is there and is a folder; anything else is a file to be created. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Nothing at that path yet, which is the other honest reading of it: a file to write.
    return false;
  }
}

/**
 * Where the file goes. Whether it may land on top of anything is not decided here — see
 * {@link writeAttachment}.
 *
 * Unasked, the file goes into a directory made for it rather than straight into the shared temp
 * folder. `screenshot.png` is the commonest name an attachment has, and two of them written side
 * by side would collide for a reason that is nobody's fault and has no good answer. A folder of
 * its own costs one syscall and keeps the real filename, which is what tells a reader what kind of
 * file it is.
 *
 * A `saveTo` that is already a folder is written into rather than over: the parameter reads as a
 * place — its own description says the default is a directory — so that is what a model passes,
 * and taking it literally would be EISDIR and a wasted round trip. The name inside it is Weeek's,
 * reduced by `safeFileName` to something that cannot climb out.
 *
 * Anything else is taken as the file to create. A missing parent above it fails, and is left to,
 * because quietly creating directories nobody asked for is worse than saying the folder is not
 * there.
 *
 * Every `saveTo` has to land inside the root, and what is checked is the **parent directory**,
 * resolved through realpath. The file itself is often not there yet — that is the ordinary case —
 * so it has no real path to check, while its parent always does. Resolving the parent also settles
 * the symlink question for the directory half of the path in one call, and the returned path is
 * rebuilt from that resolved parent, so what gets written is the location that was checked rather
 * than the spelling that was passed.
 *
 * With no `saveTo` there is no root involved at all, and deliberately so: `mkdtemp` creates a
 * fresh private directory that nothing else has a name for, so there is nothing there to overwrite
 * and nobody else's file to reach. Requiring an operator to configure a root before an attachment
 * can be read into a scratch directory would turn the tool off for the case it is used for most.
 */
async function targetPath(
  saveTo: string | undefined,
  name: string,
  root: string | null,
): Promise<string> {
  if (saveTo === undefined) {
    const folder = await mkdtemp(join(tmpdir(), "weeek-attachment-"));
    return join(folder, safeFileName(name));
  }

  if (root === null) {
    throw noRoot(
      "write to a path you name",
      " Asking for this attachment without saveTo still works: it is written to a fresh temporary" +
        " directory and the answer says where.",
    );
  }

  // A directory is written into rather than over, so it is its own parent for this purpose.
  const intoDirectory = await isDirectory(saveTo);
  const parent = intoDirectory ? saveTo : dirname(saveTo);

  const resolvedParent = await realpathOrNull(parent);
  if (resolvedParent === null) {
    throw new Error(`${parent} does not exist, so ${saveTo} cannot be written.`);
  }
  if (!isInsideRoot(root, resolvedParent)) {
    throw outsideRoot(saveTo, root, "write to");
  }

  // safeFileName on both branches. It used to run only on the name Weeek supplied, which tied the
  // protection to where a name came from rather than to the name itself — and the caller here is a
  // model reading other people's comments, so "the caller chose it" is not the reassurance it
  // sounds like. `saveTo: <root>/.envrc` wrote `.envrc` verbatim while an attachment called
  // `.envrc` became `attachment-.envrc`.
  const target = join(
    resolvedParent,
    safeFileName(intoDirectory ? name : basename(saveTo)),
  );

  // The parent being inside the root does not settle the last component: it can itself be a
  // symlink out of the root, and "w" follows one where "wx" refuses. Checked whether or not
  // overwrite was asked for, so that one rule covers both flags.
  const existing = await realpathOrNull(target);
  if (existing !== null && !isInsideRoot(root, existing)) {
    throw outsideRoot(`${target}, which leads to ${existing},`, root, "write to");
  }

  return target;
}

/**
 * Writes the file, and by default refuses to replace one already at that path.
 *
 * The refusal is the security control on this tool, so it is worth saying what it is for rather
 * than leaving it to read as tidiness. Both halves of a download are chosen by somebody else: the
 * bytes belong to whoever attached the file to the task, and the path comes from a model that has
 * just been reading task descriptions and comments — text written by other people, which is what
 * this server exists to feed it. An overwrite reachable from that combination is attacker-chosen
 * bytes at an attacker-chosen path, and paths like `~/.zshrc` turn that into code that runs at the
 * next shell.
 *
 * Refusing by default is what makes that unreachable rather than merely discouraged. It is a
 * deterministic no; a confirmation prompt is something a person clicks through, and annotations are
 * static per tool, so a prompt could not be raised for the dangerous case alone anyway.
 *
 * `overwrite` is the caller's way back in for the ordinary reason — fetching the same attachment
 * twice into the same path — and it has to be asked for each time.
 */
async function writeAttachment(path: string, bytes: Buffer, overwrite: boolean): Promise<void> {
  try {
    // "wx" fails if the path exists, and it does so in the same call that writes — a stat first
    // would leave a window between asking and writing.
    await writeFile(path, bytes, { flag: overwrite ? "w" : "wx" });
  } catch (error) {
    // Optional, so that a rejection which is not an Error at all is rethrown rather than turned
    // into a TypeError from reading .code off it.
    if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw error;
    throw new Error(
      `${path} already exists and was left alone. Nothing was written. Pass overwrite: true to ` +
        "replace it, or saveTo with a path that is free.",
    );
  }
}

export function registerAttachmentTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_upload_attachment",
    {
      title: "Attach a file to a task",
      description:
        "Uploads a local file and attaches it to a task. The path is read on the machine running " +
        "this server, which is not necessarily the one you are on, and only inside the directory " +
        "that machine's operator allowed.",
      inputSchema: z.strictObject({
        taskId: weeekId().describe("The task id."),
        filePath: z
          .string()
          .min(1)
          .describe(
            "Path to the file on the machine running this server. It has to be inside the " +
              "directory that machine's operator allowed; anything outside is refused.",
          ),
        filename: nullAsAbsent(z.string().min(1)).describe(
          "Name to store it under. Defaults to the file's own name.",
        ),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ taskId, filePath, filename }) =>
      guard(async () => {
        const stored = filename ?? basename(filePath);

        if (context.fileRoot === null) {
          throw noRoot("read any local file");
        }

        // realpath, not resolve: a symlink inside the root pointing outside it would pass a check
        // made on the spelling of a path, and this is the check that decides whether ~/.ssh/id_rsa
        // can be read. It also answers null for a file that is not there, which is right too.
        const source = await realpathOrNull(filePath);
        if (source === null) {
          throw new Error(`${filePath} does not exist, or is not reachable from this server.`);
        }
        if (!isInsideRoot(context.fileRoot, source)) {
          throw outsideRoot(filePath, context.fileRoot, "read from");
        }

        // Everything below acts on the resolved path rather than the one passed in, so that the
        // file being read is the one that was checked.
        const info = await stat(source);
        // A FIFO answers a read that never ends and a device one that nothing can hold. Neither is
        // an attachment, and the size of both is a fiction.
        if (!info.isFile()) {
          throw new Error(`${filePath} is not a regular file, so there is nothing to attach.`);
        }
        // Asked before the file is read, which is the whole point: past this size the read itself
        // is the damage, and Weeek would refuse what it produced anyway.
        if (info.size > MAX_FILE_BYTES) {
          throw new Error(
            `${stored} is ${fileSize(info.size)}, and Weeek accepts at most ` +
              `${fileSize(MAX_FILE_BYTES)}. Nothing was uploaded.`,
          );
        }

        const bytes = await readFile(source);
        // The size above is what the filesystem claimed, and some regular files lie: everything
        // under /proc reports 0 and then reads to EOF. This is the same ceiling applied to what
        // actually arrived, which is the only number that was ever true.
        if (bytes.byteLength > MAX_FILE_BYTES) {
          throw new Error(
            `${stored} read as ${fileSize(bytes.byteLength)}, past the ` +
              `${fileSize(MAX_FILE_BYTES)} Weeek accepts. Nothing was uploaded.`,
          );
        }

        const formData = new FormData();
        // The brackets are part of the field name rather than a way of writing an array — Weeek
        // answers 422 without them. The boundary is fetch's to set, so the client passes formData
        // through untouched and sets no content type of its own.
        formData.append("files[]", new Blob([bytes]), stored);

        const payload = await context.client.request(OPS.uploadAttachment, {
          pathParams: { task_id: taskId },
          formData,
        });

        const files = answeredFiles(payload);
        // `uploaded` is on both answers, not only the degraded one. A flag a model learns from one
        // call and finds undefined on the next is worse than no flag at all — it reads as a
        // failure precisely when everything went right.
        return jsonResult(
          withWarning(
            files === null
              ? {
                  taskId,
                  filename: stored,
                  uploaded: true,
                  note:
                    "Weeek accepted the file but answered without its details, so its id is not " +
                    "here. Read the task's attachments with weeek_get_task.",
                }
              : { taskId, attachments: files, uploaded: true },
            context.fileRootWarning,
          ),
        );
      }),
  );

  server.registerTool(
    "weeek_get_attachment",
    {
      title: "Download an attachment",
      description:
        "Downloads a task's attachment and returns the path it was saved to. The file's contents " +
        "are not returned — attachments are usually screenshots, and inlining one would flood " +
        "the context. File ids come from a task's attachments field in weeek_get_task. A file " +
        "already at the target path is never replaced unless you pass overwrite.",
      inputSchema: z.strictObject({
        fileId: z.string().min(1).describe("The attachment id, from a task's attachments field."),
        saveTo: nullAsAbsent(z.string().min(1)).describe(
          "Where to write it. Defaults to a temporary directory.",
        ),
        overwrite: nullAsAbsent(z.boolean()).describe(
          "Replace a file already at that path. Off by default, and the call fails rather " +
            "than replacing one.",
        ),
      }),
      // Not READ_ONLY_ANNOTATIONS, though it only reads from Weeek: readOnlyHint means the tool
      // does not modify its environment, and this one writes a file to the user's disk. The label
      // has to describe what the tool does, not which half of it we find interesting.
      //
      // Nor DESTRUCTIVE_ANNOTATIONS. Under the gate in shared.ts that would prompt on every call
      // including the overwhelmingly common one that writes to a fresh temporary directory, and a
      // prompt raised every time is a prompt people learn to dismiss. What keeps someone else's
      // bytes off an existing path is writeAttachment's refusal, not a hint.
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ fileId, saveTo, overwrite }) =>
      guard(async () => {
        // This endpoint answers with JSON describing the file, not with the file. The bytes are
        // one hop further on, behind the link it carries.
        const payload = await context.client.request(OPS.getAttachment, {
          pathParams: { file_id: fileId },
        });

        const meta = unwrapEnvelope<AttachmentMeta>(payload, "data");
        // unwrapEnvelope casts rather than checks, and what comes out of it here is handed to
        // fetch. Without this, a body without a link fails as "Failed to parse URL: undefined".
        if (typeof meta.url !== "string" || meta.url === "") {
          throw new Error(
            `Weeek described attachment ${fileId} but gave no link to download it from.`,
          );
        }

        // The body is collected whole before any of it is written, so the same ceiling the upload
        // keeps applies coming down. The size is already in hand here — one comparison, and a file
        // too large to hold is refused before the transfer rather than during it. Weeek stores
        // nothing above this, so a size past it means the metadata is wrong, not that the file is.
        if (typeof meta.size === "number" && meta.size > MAX_FILE_BYTES) {
          throw new Error(
            `Attachment ${fileId} is ${fileSize(meta.size)}, past the ${fileSize(MAX_FILE_BYTES)} ` +
              "this server will hold in memory. Nothing was downloaded.",
          );
        }

        // The link answers 303 and leads to storage, where a presigned signature is what
        // authorises the request. Our token is not needed there and is not sent: this is a
        // third-party host, and a bearer token handed to one is a credential given away.
        const response = await fetch(meta.url, {
          redirect: "follow",
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `The storage host answered ${response.status} for attachment ${fileId}. ` +
              "The download link is signed and lasts about an hour, so ask for the attachment " +
              "again rather than retrying this one.",
          );
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        const name = typeof meta.name === "string" ? meta.name : "";
        // Resolved after the bytes are in hand, so that a download which never arrives leaves no
        // empty file and no temporary folder behind it.
        const target = await targetPath(saveTo, name, context.fileRoot);
        await writeAttachment(target, bytes, overwrite === true);

        // The size is what was written, not what the metadata claimed: that is the file the
        // caller has been handed a path to.
        return jsonResult(
          withWarning(
            {
              fileId,
              name: name === "" ? null : name,
              size: bytes.byteLength,
              savedTo: target,
            },
            context.fileRootWarning,
          ),
        );
      }),
  );
}
