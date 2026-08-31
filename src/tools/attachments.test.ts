import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { type IncomingHttpHeaders, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { WeeekApiError } from "../http/quirks.ts";
import { captureTools, payloadOf, shapeOf, textOf, toolContext } from "../testing/tools.ts";
import { WRITE_ANNOTATIONS } from "./shared.ts";
import { registerGetAttachmentTool, safeFileName, writeAttachment } from "./attachments.ts";

test("an ordinary name is kept exactly as Weeek spelled it", () => {
  assert.equal(safeFileName("изображение.png"), "изображение.png");
});

test("a name carrying directories cannot lead the write out of its folder", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("a/b/c.png"), "c.png");
});

test("a name that is empty or nothing but dots is replaced", () => {
  assert.equal(safeFileName(""), "attachment");
  assert.equal(safeFileName(".."), "attachment");
  assert.equal(safeFileName("   "), "attachment");
});

test("whatever the name, joining it lands directly inside the folder and nowhere else", () => {
  // The property the three tests above only sample. What the caller actually does with the result
  // is join it to a folder and write there, so that is what is asserted: the file is a child of
  // that folder, for every shape of name that has ever been used to climb out of one.
  const folder = join(tmpdir(), "weeek-attachments");

  for (const name of [
    "../../etc/passwd",
    "..",
    ".",
    "",
    "   ",
    "a/b/../../../../c.png",
    "/etc/passwd",
    "..\\..\\windows",
    "screenshot.png",
  ]) {
    assert.equal(
      dirname(join(folder, safeFileName(name))),
      folder,
      `${JSON.stringify(name)} landed outside ${folder}`,
    );
  }
});

test("a leading dot is taken off the magic, not off the name", () => {
  assert.equal(safeFileName(".envrc"), "attachment-.envrc");
  assert.equal(safeFileName(".zshenv"), "attachment-.zshenv");
  assert.equal(safeFileName("a/b/.gitconfig"), "attachment-.gitconfig");
  // Still a name, and still the one Weeek gave, so an ordinary file is untouched.
  assert.equal(safeFileName("notes.md"), "notes.md");
  assert.equal(safeFileName("archive.tar.gz"), "archive.tar.gz");
});

test("a write never lands on a file that is already there", async (t) => {
  // Unreachable through the tool, and kept anyway: the folder is fresh, but the name inside it is
  // whatever the person who attached the file called it, and "this call can only ever create a
  // file" is worth being true rather than merely likely. It is asserted here because there is
  // nowhere else left to assert it — every path the tool builds is empty by construction, so a
  // silent change of "wx" to "w" would otherwise pass the whole suite.
  const dir = await mkdtemp(join(tmpdir(), "weeek-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, "screenshot.png");
  await writeFile(target, "STALE");

  await assert.rejects(
    () => writeAttachment(target, Buffer.from("FRESH")),
    /already exists/,
  );
  // The assertion that matters. Anything that writes the file makes this line fail, whatever the
  // answer said.
  assert.equal(await readFile(target, "utf8"), "STALE");
});

/**
 * A stand-in for the storage Weeek's signed link points at: one redirect, then the bytes.
 *
 * A real server rather than a stubbed fetch, because the property that matters most here cannot be
 * observed any other way — whether our bearer token is sent to a host that is not Weeek. Only
 * something on the receiving end can say what arrived, so the headers of every request are kept.
 */
type Storage = {
  url: string;
  headers: IncomingHttpHeaders[];
  close: () => Promise<void>;
};

async function storage(bytes: Buffer, failWith?: number): Promise<Storage> {
  const headers: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    headers.push(request.headers);

    if (failWith !== undefined) {
      response.writeHead(failWith, { "content-type": "application/xml" });
      response.end("<Error><Code>AccessDenied</Code></Error>");
      return;
    }

    // The live link answers 303 and points at S3; following it is what yields the file.
    if (request.url === "/signed") {
      response.writeHead(303, { location: "/bytes" });
      response.end();
      return;
    }

    response.writeHead(200, { "content-type": "image/png" });
    response.end(bytes);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/signed`,
    headers,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function attachmentTools(responses: Record<string, unknown>) {
  return captureTools(registerGetAttachmentTool, toolContext(responses));
}

function tool(responses: Record<string, unknown>) {
  const found = attachmentTools(responses).get("weeek_get_attachment");
  assert.ok(found !== undefined, "weeek_get_attachment did not register");
  return found;
}

const META_PATH = "/ws/attachments/{file_id}";

/** The metadata call, which answers with a link rather than with the file. */
function meta(name: string, url: string) {
  return { success: true, data: { id: "f-1", name, url, size: 4, service: "s3" } };
}

/**
 * The directories this tool has made in the system temp folder.
 *
 * Compared before and against after, it is how a test says "and nothing was left behind" now that
 * the tool alone chooses where the file goes. Safe as a global read because nothing else in this
 * repository writes that prefix, and the tests in this file run one after another.
 */
async function attachmentFolders(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((entry) => entry.startsWith("weeek-attachment-"));
}

test("a signed link is followed through its redirect and the bytes land on disk", async (t) => {
  const store = await storage(Buffer.from("PNG-BYTES"));
  t.after(() => store.close());

  const payload = payloadOf(
    await tool({ [META_PATH]: meta("screenshot.png", store.url) }).handler({ fileId: "f-1" }),
  );

  const savedTo = String(payload["savedTo"]);
  t.after(() => rm(dirname(savedTo), { recursive: true, force: true }));

  assert.equal(basename(savedTo), "screenshot.png");
  assert.equal(await readFile(savedTo, "utf8"), "PNG-BYTES");
  assert.equal(payload["fileId"], "f-1");
  // The bytes themselves are deliberately not in the answer: an attachment is usually a screenshot
  // and inlining one would flood the context this whole server is built to spend carefully.
  assert.equal("content" in payload, false);
});

test("our token is never sent to the host the link points at", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());

  const payload = payloadOf(
    await tool({ [META_PATH]: meta("a.png", store.url) }).handler({ fileId: "f-1" }),
  );
  t.after(() => rm(dirname(String(payload["savedTo"])), { recursive: true, force: true }));

  // The presigned signature is what authorises the download; our bearer token is not needed and
  // would be handed to a third-party host for nothing. Both the redirect and the request after it
  // are checked — a client that carried the header across the hop would leak it just the same.
  assert.equal(store.headers.length, 2);
  for (const sent of store.headers) assert.equal(sent.authorization, undefined);
});

test("two attachments named alike do not overwrite one another", async (t) => {
  const first = await storage(Buffer.from("FIRST"));
  const second = await storage(Buffer.from("SECOND"));
  t.after(() => first.close());
  t.after(() => second.close());

  // "screenshot.png" is the commonest name an attachment has, and this tool alone decides where
  // the file goes — so nothing the caller does can keep two of them apart. Written to one shared
  // folder, the second download silently replaces the first, and a model that reads both files
  // afterwards sees the same bytes twice with nothing to tell it so. A directory per download is
  // what makes that impossible rather than merely unlikely.
  const one = payloadOf(
    await tool({ [META_PATH]: meta("screenshot.png", first.url) }).handler({ fileId: "f-1" }),
  );
  const two = payloadOf(
    await tool({ [META_PATH]: meta("screenshot.png", second.url) }).handler({ fileId: "f-2" }),
  );

  const onePath = String(one["savedTo"]);
  const twoPath = String(two["savedTo"]);
  t.after(() => rm(dirname(onePath), { recursive: true, force: true }));
  t.after(() => rm(dirname(twoPath), { recursive: true, force: true }));

  assert.notEqual(onePath, twoPath);
  assert.equal(basename(onePath), "screenshot.png");
  assert.equal(basename(twoPath), "screenshot.png");
  assert.equal(await readFile(onePath, "utf8"), "FIRST");
  assert.equal(await readFile(twoPath, "utf8"), "SECOND");
});

test("a name that would climb out of the folder is cut down to a file inside it", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());

  // The name is whatever the person who attached the file called it, and it goes straight into a
  // path on this machine. The directory being fresh settles where the write starts, not where a
  // name full of `..` would take it from there.
  const payload = payloadOf(
    await tool({ [META_PATH]: meta("../../../../etc/passwd", store.url) }).handler({
      fileId: "f-1",
    }),
  );

  const savedTo = String(payload["savedTo"]);
  t.after(() => rm(dirname(savedTo), { recursive: true, force: true }));

  assert.equal(basename(savedTo), "passwd");
  assert.equal(dirname(dirname(savedTo)), tmpdir());
  assert.deepEqual(await readdir(dirname(savedTo)), ["passwd"]);
});

test("a name Weeek chose cannot start with a dot", async (t) => {
  const store = await storage(Buffer.from("ATTACKER"));
  t.after(() => store.close());

  // The folder is thrown away; the file is not. A person shown this path copies the file out of
  // it, and .envrc is executed by direnv at the next cd into wherever it lands.
  const payload = payloadOf(
    await tool({ [META_PATH]: meta(".envrc", store.url) }).handler({ fileId: "f-1" }),
  );

  const savedTo = String(payload["savedTo"]);
  t.after(() => rm(dirname(savedTo), { recursive: true, force: true }));

  assert.equal(basename(savedTo), "attachment-.envrc");
  assert.deepEqual(await readdir(dirname(savedTo)), ["attachment-.envrc"]);
});

test("an attachment too large to hold is refused before it is fetched", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const before = await attachmentFolders();

  // The body is collected whole before any of it is written, so the size the metadata already
  // carries is compared before the transfer rather than a 200 MB buffer being built during it.
  const oversized = {
    success: true,
    data: { id: "f-1", name: "huge.bin", url: store.url, size: 200 * 1024 * 1024 },
  };

  const result = await tool({ [META_PATH]: oversized }).handler({ fileId: "f-1" });

  assert.equal(result.isError, true);
  // Both numbers, so the answer says how far over it is rather than only that it is over — and the
  // exact bytes with them, because one byte over renders as "100.0 MB, at most 100.0 MB" without.
  assert.match(textOf(result), /200\.0 MB \(209715200 bytes\)/);
  assert.match(textOf(result), /100\.0 MB \(104857600 bytes\)/);
  // Nothing fetched and nothing made: the guard is worth nothing if it runs after the transfer.
  assert.equal(store.headers.length, 0);
  assert.deepEqual(await attachmentFolders(), before);
});

test("a link that has expired says so instead of leaving an empty directory", async (t) => {
  const store = await storage(Buffer.alloc(0), 403);
  t.after(() => store.close());
  const before = await attachmentFolders();

  const result = await tool({ [META_PATH]: meta("a.png", store.url) }).handler({ fileId: "f-1" });

  assert.equal(result.isError, true);
  // The signature lasts about an hour, so the way out is a fresh metadata call, not a retry of
  // this same link. Saying 403 alone would not tell a model that.
  assert.match(textOf(result), /403/);
  assert.match(textOf(result), /hour/);
  // The folder is made after the bytes are in hand, which is what keeps a failed download from
  // littering the temp directory with empty ones.
  assert.deepEqual(await attachmentFolders(), before);
});

test("an attachment id nobody knows is reported with what Weeek said", async () => {
  const failing = new WeeekApiError("Weeek responded 400", 400, "GET", "https://api/att", {
    success: false,
    code: 1000001,
    message: "Model not found",
  });

  const result = await tool({ [META_PATH]: failing }).handler({ fileId: "nope" });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Model not found \(code 1000001\)/);
});

test("downloading is the only attachment tool, it writes, and it takes one argument", () => {
  const tools = attachmentTools({});

  assert.deepEqual([...tools.keys()], ["weeek_get_attachment"]);
  // Downloading reads from Weeek and writes to this machine. readOnlyHint means "does not modify
  // its environment", so claiming it here would be false — and it is the branch of the prompt gate
  // that never asks, which is a strong thing to claim falsely for a tool that writes to disk.
  assert.deepEqual(tools.get("weeek_get_attachment")?.config.annotations, WRITE_ANNOTATIONS);

  // fileId and nothing beside it. The tool used to take a path to write to and a flag to overwrite
  // what was there; both are gone, and the destination is this server's to choose. A parameter
  // added back here is a local path named by a model that has just been reading other people's
  // comments, which is the whole reason it went.
  const found = tools.get("weeek_get_attachment");
  assert.ok(found !== undefined);
  assert.deepEqual(Object.keys(shapeOf(found.config)), ["fileId"]);
});
