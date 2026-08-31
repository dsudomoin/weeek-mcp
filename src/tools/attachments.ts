import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { unwrapEnvelope } from "../http/quirks.ts";
import { OPS } from "../weeek/operations.ts";
import { WRITE_ANNOTATIONS, type ToolContext, guard, jsonResult } from "./shared.ts";

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
 * The largest file that will be held in memory.
 *
 * Weeek's own limit rather than an invented one — the spec states "Max file size is 100MB" on the
 * upload field, so nothing larger is stored and nothing larger can come back down either. This
 * tool buffers the whole file: the body is collected before any of it is written. Past this size
 * that buffer is itself the damage — a long-lived server holding gigabytes. It is also the one
 * input in this server whose size the model neither chooses nor sees.
 *
 * Whether Weeek reads "100MB" as 10^8 or as 2^20 × 100 is its own business. This takes the larger
 * reading, so that the guard can only ever refuse a file Weeek would have refused too; right at
 * the boundary Weeek is the authority and answers for itself.
 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

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
 * The dot is what makes a filename mean something to a tool rather than to a person, and the
 * folder this lands in is not always thrown away afterwards — a person who is shown the path
 * copies the file out of it. It is prefixed rather than rejected: the name stays legible, and
 * nothing legitimate is lost.
 */
export function safeFileName(name: string): string {
  const base = basename(name.trim()).replace(/^\.+$/, "");
  if (base === "") return "attachment";
  return base.startsWith(".") ? `attachment-${base}` : base;
}

/**
 * Where the file goes: a directory made for it, and Weeek's own name inside that.
 *
 * A folder per download rather than one shared scratch folder. `screenshot.png` is the commonest
 * name an attachment has, and two of them written side by side would collide for a reason that is
 * nobody's fault and has no good answer — the second would silently replace the first, and a model
 * that read both afterwards would see the same bytes twice with nothing to tell it so. A folder of
 * its own costs one syscall and keeps the real filename, which is what tells a reader what kind of
 * file it is.
 *
 * `mkdtemp` is what makes the folder private as well as fresh: it creates a directory nothing else
 * has a name for, so there is nothing there to overwrite and nobody else's file within reach. That
 * is the whole reason this tool needs no configuration to be safe.
 *
 * The name is still put through {@link safeFileName}. Where the file lands is ours; what it is
 * called is not.
 */
async function targetPath(name: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "weeek-attachment-"));
  return join(folder, safeFileName(name));
}

/**
 * Writes the file, and refuses to replace one already at that path.
 *
 * "wx" rather than "w", although the folder above it was made a moment ago and holds nothing. The
 * bytes belong to whoever attached the file to the task, and the last component of the path is the
 * name they chose; the guarantee worth stating is that this call can only ever create a file, never
 * land on one. Written as the flag on the write itself rather than as a stat first, so there is no
 * window between asking and writing.
 *
 * Exported for the same reason {@link safeFileName} is: with every destination a fresh mkdtemp
 * directory, no call made through the tool can reach an occupied path, so the refusal is only a
 * guarantee anybody can check if it is checked here directly. An untested guard is a guard that is
 * removed as tidying the next time somebody reads this file.
 */
export async function writeAttachment(path: string, bytes: Buffer): Promise<void> {
  try {
    await writeFile(path, bytes, { flag: "wx" });
  } catch (error) {
    // Optional, so that a rejection which is not an Error at all is rethrown rather than turned
    // into a TypeError from reading .code off it.
    if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw error;
    throw new Error(
      `${path} already exists and was left alone. Nothing was written. Ask for the attachment ` +
        "again — each download is written into a directory of its own.",
    );
  }
}

export function registerGetAttachmentTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "weeek_get_attachment",
    {
      title: "Download an attachment",
      description:
        "Downloads a task's attachment into a temporary directory and returns the path it was " +
        "saved to. The file's contents are not returned — attachments are usually screenshots, " +
        "and inlining one would flood the context. File ids come from a task's attachments field " +
        "in weeek_get_task.",
      inputSchema: z.strictObject({
        fileId: z.string().min(1).describe("The attachment id, from a task's attachments field."),
      }),
      // Not READ_ONLY_ANNOTATIONS, though it only reads from Weeek: readOnlyHint means the tool
      // does not modify its environment, and this one writes a file to the user's disk. The label
      // has to describe what the tool does, not which half of it we find interesting.
      //
      // Nor DESTRUCTIVE_ANNOTATIONS. Under the gate in shared.ts that would prompt on every call,
      // and a prompt raised every time is a prompt people learn to dismiss — for a tool whose only
      // effect on this machine is a new file in a directory made for it.
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ fileId }) =>
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

        // The body is collected whole before any of it is written, so the ceiling is checked
        // against the size the metadata already carries — one comparison, and a file too large to
        // hold is refused before the transfer rather than during it. Weeek stores nothing above
        // this, so a size past it means the metadata is wrong, not that the file is.
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
        const target = await targetPath(name);
        await writeAttachment(target, bytes);

        // The size is what was written, not what the metadata claimed: that is the file the
        // caller has been handed a path to.
        return jsonResult({
          fileId,
          name: name === "" ? null : name,
          size: bytes.byteLength,
          savedTo: target,
        });
      }),
  );
}
