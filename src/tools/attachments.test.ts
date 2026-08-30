import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { type IncomingHttpHeaders, createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { WeeekApiError } from "../http/quirks.ts";
import { type Call, captureTools, payloadOf, textOf, toolContext } from "../testing/tools.ts";
import { WRITE_ANNOTATIONS } from "./shared.ts";
import { registerAttachmentTools, safeFileName } from "./attachments.ts";

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

function attachmentTools(
  responses: Record<string, unknown>,
  calls: Call[] = [],
  fileRoot: string | null = null,
  warning: string | null = null,
) {
  return captureTools(registerAttachmentTools, toolContext(responses, calls, fileRoot, warning));
}

// The root is spelled out at every call site that needs one rather than defaulted to something
// permissive: which directory a test runs under is the thing most of these tests are about.
function tool(
  name: string,
  responses: Record<string, unknown>,
  calls: Call[] = [],
  fileRoot: string | null = null,
) {
  const found = attachmentTools(responses, calls, fileRoot).get(name);
  assert.ok(found !== undefined, `${name} did not register`);
  return found;
}

const UPLOAD_PATH = "/tm/tasks/{task_id}/attachments";
const META_PATH = "/ws/attachments/{file_id}";

/** The metadata call, which answers with a link rather than with the file. */
function meta(name: string, url: string) {
  return { success: true, data: { id: "f-1", name, url, size: 4, service: "s3" } };
}

async function scratch(t: TestContext): Promise<string> {
  // Resolved, because config.ts resolves WEEEK_FILE_ROOT and containment compares real paths. On
  // macOS the temp directory sits under /var, which is a symlink to /private/var, so an
  // unresolved root here would fail every containment check for a reason no test is about.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "weeek-test-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("the file goes up as multipart under the field name Weeek requires", async (t) => {
  const dir = await scratch(t);
  const source = join(dir, "screenshot.png");
  await writeFile(source, Buffer.from("PNG-BYTES"));

  const calls: Call[] = [];
  await tool("weeek_upload_attachment", { [UPLOAD_PATH]: { success: true } }, calls, dir).handler({
    taskId: 7197,
    filePath: source,
  });

  const call = calls.find((made) => made.path === UPLOAD_PATH);
  assert.equal(call?.options.pathParams?.["task_id"], 7197);
  // "files[]" and nothing else: the brackets are part of the field name, and Weeek answers 422
  // without them. The body is left to fetch, which is the only thing that can set the boundary.
  const sent = call?.options.formData?.get("files[]");
  assert.ok(sent instanceof File);
  assert.equal(sent.name, "screenshot.png");
  assert.equal(await sent.text(), "PNG-BYTES");
});

test("a file can be stored under a name other than its own", async (t) => {
  const dir = await scratch(t);
  const source = join(dir, "tmp-4a91.bin");
  await writeFile(source, Buffer.from("x"));

  const calls: Call[] = [];
  await tool("weeek_upload_attachment", { [UPLOAD_PATH]: {} }, calls, dir).handler({
    taskId: 7197,
    filePath: source,
    filename: "trace.log",
  });

  const sent = calls.find((made) => made.path === UPLOAD_PATH)?.options.formData?.get("files[]");
  assert.ok(sent instanceof File);
  assert.equal(sent.name, "trace.log");
});

/**
 * A real upload response, captured from the live API.
 *
 * `data` is a list. The generated spec declares it as a single `$ref` to Attachment, so a
 * projection written from the schema would read `data.id` and find undefined — which is why this
 * fixture is the wire's shape and not the spec's.
 */
const UPLOADED = {
  success: true,
  data: [
    {
      id: "a29f1a25-0000-4000-8000-000000000001",
      creatorId: "a12dbee4-0000-4000-8000-000000000002",
      service: "weeek",
      name: "probe-file.txt",
      url: "https://api.weeek.net/ws/593578/files/probe?expires=1&signature=2",
      createdAt: "2026-08-29T22:23:41+00:00",
      size: 27,
    },
  ],
};

test("the stored file comes back as an id, a name and a size, and nothing else", async (t) => {
  const dir = await scratch(t);
  const source = join(dir, "probe-file.txt");
  await writeFile(source, Buffer.from("x"));

  const payload = payloadOf(
    await tool("weeek_upload_attachment", { [UPLOAD_PATH]: UPLOADED }, [], dir).handler({
      taskId: 7197,
      filePath: source,
    }),
  );

  assert.equal(payload["taskId"], 7197);
  assert.deepEqual(payload["attachments"], [
    { id: "a29f1a25-0000-4000-8000-000000000001", name: "probe-file.txt", size: 27 },
  ]);
  // On both answers, so a flag learned from one call is not undefined on the next.
  assert.equal(payload["uploaded"], true);
  // The link is dropped on purpose: some 180 characters of presigned url that stops working within
  // the hour, for a thing weeek_get_attachment fetches fresh at the moment it is wanted.
  assert.equal(JSON.stringify(payload).includes("signature"), false);
  assert.equal(JSON.stringify(payload).includes("creatorId"), false);
});

test("an upload that landed is never reported as one that did not", async (t) => {
  const dir = await scratch(t);
  const source = join(dir, "a.txt");
  await writeFile(source, Buffer.from("x"));

  // Same reasoning as the comment write: told the upload failed, a model sends the file again and
  // the task carries it twice. An empty list is read the same way — a body that named no file is
  // not one to read an id out of, and `attachments: []` would read as a success naming nothing.
  // {data: [null]} is the one that slips past a length check: a non-empty list whose only entry
  // survives the projection as nothing, leaving `attachments: []` — the success that names nothing.
  for (const answered of [
    { success: true },
    { success: true, data: {} },
    { data: [] },
    { data: [null] },
  ]) {
    const payload = payloadOf(
      await tool("weeek_upload_attachment", { [UPLOAD_PATH]: answered }, [], dir).handler({
        taskId: 7197,
        filePath: source,
      }),
    );

    assert.equal(payload["uploaded"], true, JSON.stringify(answered));
    assert.equal(payload["taskId"], 7197);
    assert.equal(payload["filename"], "a.txt");
    assert.match(String(payload["note"]), /weeek_get_task/);
  }
});

test("a file past Weeek's limit is refused before it is read, not after it is sent", async (t) => {
  const dir = await scratch(t);
  const source = join(dir, "huge.bin");
  // Sparse: the file measures 200 MB and occupies almost nothing. Reading it is what the guard
  // exists to prevent, so a test that had to write 200 MB to prove that would be self-defeating.
  await writeFile(source, "");
  await truncate(source, 200 * 1024 * 1024);

  const calls: Call[] = [];
  const result = await tool("weeek_upload_attachment", {}, calls, dir).handler({
    taskId: 7197,
    filePath: source,
  });

  assert.equal(result.isError, true);
  // Both numbers, so the answer says how far over it is rather than only that it is over — and the
  // exact bytes with them, because one byte over renders as "100.0 MB, at most 100.0 MB" without.
  assert.match(textOf(result), /200\.0 MB \(209715200 bytes\)/);
  assert.match(textOf(result), /100\.0 MB \(104857600 bytes\)/);
  assert.equal(
    calls.some((made) => made.path === UPLOAD_PATH),
    false,
    "an oversized file was sent anyway",
  );
});

test("a file that is not there is reported, and nothing is sent", async (t) => {
  const dir = await scratch(t);

  const calls: Call[] = [];
  const result = await tool("weeek_upload_attachment", {}, calls, dir).handler({
    taskId: 7197,
    filePath: join(dir, "missing.png"),
  });

  assert.equal(result.isError, true);
  // Ours rather than an errno: the path is resolved before it is opened, so a file that is not
  // there is answered by the same call that decides whether it is inside the root.
  assert.match(textOf(result), /does not exist/);
  assert.equal(calls.some((made) => made.path === UPLOAD_PATH), false);
});

test("a signed link is followed through its redirect and the bytes land on disk", async (t) => {
  const store = await storage(Buffer.from("PNG-BYTES"));
  t.after(() => store.close());

  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("screenshot.png", store.url) }).handler({
      fileId: "f-1",
    }),
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
    await tool("weeek_get_attachment", { [META_PATH]: meta("a.png", store.url) }).handler({
      fileId: "f-1",
    }),
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

  // "screenshot.png" is the commonest name an attachment has. Written to one shared folder, the
  // second download silently replaces the first, and a model that reads both files afterwards sees
  // the same bytes twice with nothing to tell it so.
  const one = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("screenshot.png", first.url) }).handler({
      fileId: "f-1",
    }),
  );
  const two = payloadOf(
    await tool("weeek_get_attachment", {
      [META_PATH]: meta("screenshot.png", second.url),
    }).handler({ fileId: "f-2" }),
  );

  const onePath = String(one["savedTo"]);
  const twoPath = String(two["savedTo"]);
  t.after(() => rm(dirname(onePath), { recursive: true, force: true }));
  t.after(() => rm(dirname(twoPath), { recursive: true, force: true }));

  assert.notEqual(onePath, twoPath);
  assert.equal(await readFile(onePath, "utf8"), "FIRST");
  assert.equal(await readFile(twoPath, "utf8"), "SECOND");
});

test("a folder asked for is written into, not written over", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const dir = await scratch(t);

  // "Where to write it. Defaults to a temporary directory" reads as a folder, so a model passes
  // one. Writing to it as though it were a file is EISDIR and a wasted round trip.
  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("a.png", store.url) }, [], dir).handler({
      fileId: "f-1",
      saveTo: dir,
    }),
  );

  assert.equal(payload["savedTo"], join(dir, "a.png"));
  assert.equal(await readFile(join(dir, "a.png"), "utf8"), "x");
});

test("a folder will not take a second file under a name Weeek chose", async (t) => {
  const store = await storage(Buffer.from("SECOND"));
  t.after(() => store.close());
  const dir = await scratch(t);
  await writeFile(join(dir, "screenshot.png"), Buffer.from("FIRST"));

  // The folder is the caller's, but the name inside it is Weeek's — so this is the same collision
  // the temporary directory exists to prevent, and it gets the same answer rather than a savedTo
  // that reads plausibly over bytes it replaced.
  const result = await tool(
    "weeek_get_attachment",
    { [META_PATH]: meta("screenshot.png", store.url) },
    [],
    dir,
  ).handler({ fileId: "f-2", saveTo: dir });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /already exists/);
  // Says how to get what was asked for, rather than only that it did not happen.
  assert.match(textOf(result), /overwrite: true/);
  assert.equal(await readFile(join(dir, "screenshot.png"), "utf8"), "FIRST");
});

test("a path asked for is the path written, name and all", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const dir = await scratch(t);
  const target = join(dir, "renamed.png");

  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("a.png", store.url) }, [], dir).handler({
      fileId: "f-1",
      saveTo: target,
    }),
  );

  assert.equal(payload["savedTo"], target);
  assert.equal(await readFile(target, "utf8"), "x");
});

test("bytes from Weeek do not land on a file that is already there", async (t) => {
  const store = await storage(Buffer.from("FRESH"));
  t.after(() => store.close());
  const dir = await scratch(t);
  const target = join(dir, "renamed.png");
  await writeFile(target, Buffer.from("STALE"));

  // This is the security control on this tool, so it is the test that has to fail if anyone ever
  // restores the old unconditional overwrite. Both halves of a download belong to somebody else:
  // the bytes to whoever attached the file, and the path to a model that has just been reading
  // descriptions and comments other people wrote. Left overwriting, that pair reaches
  // attacker-chosen bytes at an attacker-chosen path — ~/.zshrc, and the next shell runs it.
  const result = await tool(
    "weeek_get_attachment",
    { [META_PATH]: meta("a.png", store.url) },
    [],
    dir,
  ).handler({ fileId: "f-1", saveTo: target });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /already exists/);
  assert.match(textOf(result), /overwrite: true/);
  // The assertion that matters. Anything that writes the file makes this line fail, whatever the
  // answer said.
  assert.equal(await readFile(target, "utf8"), "STALE");
});

test("overwrite: true is how a caller replaces a file on purpose", async (t) => {
  const store = await storage(Buffer.from("FRESH"));
  t.after(() => store.close());
  const dir = await scratch(t);
  const target = join(dir, "renamed.png");
  await writeFile(target, Buffer.from("STALE"));

  // The refusal cannot be the whole story: fetching the same attachment twice into the same path
  // is an ordinary thing to want, and a guard with no way through it gets removed rather than
  // used. Asked for explicitly, per call.
  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("a.png", store.url) }, [], dir).handler({
      fileId: "f-1",
      saveTo: target,
      overwrite: true,
    }),
  );

  assert.equal(payload["savedTo"], target);
  assert.equal(await readFile(target, "utf8"), "FRESH");
});

test("overwrite: true reaches a name inside a folder too", async (t) => {
  const store = await storage(Buffer.from("SECOND"));
  t.after(() => store.close());
  const dir = await scratch(t);
  await writeFile(join(dir, "screenshot.png"), Buffer.from("FIRST"));

  // One flag, one meaning, wherever the path came from. The folder case refused before this
  // parameter existed, and it is the same refusal now rather than a separate rule.
  const payload = payloadOf(
    await tool(
      "weeek_get_attachment",
      { [META_PATH]: meta("screenshot.png", store.url) },
      [],
      dir,
    ).handler({ fileId: "f-2", saveTo: dir, overwrite: true }),
  );

  assert.equal(payload["savedTo"], join(dir, "screenshot.png"));
  assert.equal(await readFile(join(dir, "screenshot.png"), "utf8"), "SECOND");
});

test("an attachment too large to hold is refused before it is fetched", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const dir = await scratch(t);

  // The body is collected whole before any of it is written, so the ceiling the upload keeps
  // applies coming down too — and the size is already in hand, one comparison before the transfer
  // rather than a 200 MB buffer during it.
  const oversized = {
    success: true,
    data: { id: "f-1", name: "huge.bin", url: store.url, size: 200 * 1024 * 1024 },
  };

  const result = await tool("weeek_get_attachment", { [META_PATH]: oversized }).handler({
    fileId: "f-1",
    saveTo: dir,
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /200\.0 MB \(209715200 bytes\)/);
  assert.match(textOf(result), /100\.0 MB \(104857600 bytes\)/);
  // Nothing fetched and nothing written: the guard is worth nothing if it runs after the transfer.
  assert.equal(store.headers.length, 0);
  assert.deepEqual(await readdir(dir), []);
});

test("a name that would climb out of the folder is cut down to a file inside it", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const dir = await scratch(t);

  const payload = payloadOf(
    await tool(
      "weeek_get_attachment",
      { [META_PATH]: meta("../../../../etc/passwd", store.url) },
      [],
      dir,
    ).handler({ fileId: "f-1", saveTo: dir }),
  );

  assert.equal(payload["savedTo"], join(dir, "passwd"));
});

test("a link that has expired says so instead of leaving an empty file", async (t) => {
  const store = await storage(Buffer.alloc(0), 403);
  t.after(() => store.close());
  const dir = await scratch(t);

  const result = await tool("weeek_get_attachment", {
    [META_PATH]: meta("a.png", store.url),
  }).handler({ fileId: "f-1", saveTo: dir });

  assert.equal(result.isError, true);
  // The signature lasts about an hour, so the way out is a fresh metadata call, not a retry of
  // this same link. Saying 403 alone would not tell a model that.
  assert.match(textOf(result), /403/);
  assert.match(textOf(result), /hour/);
  assert.deepEqual(await readdir(dir), []);
});

test("an attachment id nobody knows is reported with what Weeek said", async () => {
  const failing = new WeeekApiError("Weeek responded 400", 400, "GET", "https://api/att", {
    success: false,
    code: 1000001,
    message: "Model not found",
  });

  const result = await tool("weeek_get_attachment", { [META_PATH]: failing }).handler({
    fileId: "nope",
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /Model not found \(code 1000001\)/);
});

test("both attachment tools write, and both stay in a closed world", () => {
  const tools = attachmentTools({});

  assert.deepEqual([...tools.keys()], ["weeek_upload_attachment", "weeek_get_attachment"]);
  assert.deepEqual(tools.get("weeek_upload_attachment")?.config.annotations, WRITE_ANNOTATIONS);
  // Downloading reads from Weeek and writes to this machine. readOnlyHint means "does not modify
  // its environment", so claiming it here would be false — and it is the branch of the prompt gate
  // that never asks, which is a strong thing to claim falsely for a tool that writes to disk.
  assert.deepEqual(tools.get("weeek_get_attachment")?.config.annotations, WRITE_ANNOTATIONS);
});

// --- The file root -------------------------------------------------------------------------
//
// The threat these cover is the one this whole server is built around: it feeds a model text that
// other people wrote, and it holds a tool that reads any local file, a tool that writes one, and a
// channel back to whoever wrote that text. Each test below is the difference between an injected
// comment being a nuisance and it being an exfiltration.

test("uploading refuses outright when no root has been named", async (t) => {
  const dir = await scratch(t);
  const source = join(dir, "a.txt");
  await writeFile(source, Buffer.from("x"));

  const calls: Call[] = [];
  const result = await tool("weeek_upload_attachment", {}, calls).handler({
    taskId: 7197,
    filePath: source,
  });

  assert.equal(result.isError, true);
  // Names the variable, because the person who can fix this is the operator and not the caller.
  assert.match(textOf(result), /WEEEK_FILE_ROOT/);
  // And says it is a rule, so that a model reads it as settled rather than as an argument to be
  // won with a different path. This is the difference between one refusal and a search.
  assert.match(textOf(result), /rule of the server/);
  assert.equal(
    calls.some((made) => made.path === UPLOAD_PATH),
    false,
  );
});

test("uploading refuses a file outside the root", async (t) => {
  const root = await scratch(t);
  const elsewhere = await scratch(t);
  const secret = join(elsewhere, "id_rsa");
  await writeFile(secret, Buffer.from("PRIVATE KEY"));

  const calls: Call[] = [];
  const result = await tool("weeek_upload_attachment", {}, calls, root).handler({
    taskId: 7197,
    filePath: secret,
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /outside/);
  assert.match(textOf(result), /rule of the server/);
  assert.equal(
    calls.some((made) => made.path === UPLOAD_PATH),
    false,
    "a file outside the root was uploaded anyway",
  );
});

test("uploading resolves symlinks before deciding, so one cannot lead out of the root", async (t) => {
  const root = await scratch(t);
  const elsewhere = await scratch(t);
  const secret = join(elsewhere, "id_rsa");
  await writeFile(secret, Buffer.from("PRIVATE KEY"));
  // Spelled inside the root, pointing outside it. This is the whole reason the check is realpath
  // and not resolve: on the spelling alone this path passes.
  const decoy = join(root, "screenshot.png");
  await symlink(secret, decoy);

  const calls: Call[] = [];
  const result = await tool("weeek_upload_attachment", {}, calls, root).handler({
    taskId: 7197,
    filePath: decoy,
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /outside/);
  assert.equal(
    calls.some((made) => made.path === UPLOAD_PATH),
    false,
    "a symlink out of the root was followed and the file uploaded",
  );
});

test("uploading refuses anything that is not a regular file", async (t) => {
  const root = await scratch(t);
  const socketPath = join(root, "weeek.sock");
  const server = createNetServer();
  await new Promise<void>((ready) => server.listen(socketPath, ready));
  t.after(() => new Promise<void>((done) => server.close(() => done())));

  const calls: Call[] = [];
  // A socket and a directory stand in for the class: something inside the root that passes every
  // path check and is still not a file. The dangerous member of that class is the one that cannot
  // be created portably here — a FIFO reports size 0, sails past a ceiling compared against stat,
  // and then reads whatever is written to it, and on Linux /proc/self/environ behaves the same way
  // while being a *regular* file, which is where this server's own WEEEK_API_TOKEN lives. A FIFO
  // is deliberately not used: with this guard removed, readFile on one blocks forever, so the test
  // proving the guard would hang the suite instead of failing it.
  for (const notAFile of [socketPath, root]) {
    const result = await tool("weeek_upload_attachment", {}, calls, root).handler({
      taskId: 7197,
      filePath: notAFile,
    });

    assert.equal(result.isError, true, notAFile);
    assert.match(textOf(result), /not a regular file/);
  }

  assert.equal(
    calls.some((made) => made.path === UPLOAD_PATH),
    false,
  );
});

test("downloading to a named path refuses when no root has been named", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const dir = await scratch(t);

  const result = await tool("weeek_get_attachment", {
    [META_PATH]: meta("a.png", store.url),
  }).handler({ fileId: "f-1", saveTo: dir });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /WEEEK_FILE_ROOT/);
  // Says what still works, so the refusal leaves a way to get the attachment rather than only
  // taking one away.
  assert.match(textOf(result), /without saveTo/);
  assert.deepEqual(await readdir(dir), []);
});

test("downloading with no saveTo needs no root at all", async (t) => {
  const store = await storage(Buffer.from("BYTES"));
  t.after(() => store.close());

  // The common case, and it must not be collateral damage of the root. mkdtemp makes a fresh
  // private directory nothing else has a name for: there is nothing there to overwrite and
  // nobody else's file within reach, so a root would add nothing to protect.
  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("a.png", store.url) }).handler({
      fileId: "f-1",
    }),
  );

  const saved = String(payload["savedTo"]);
  t.after(() => rm(dirname(saved), { recursive: true, force: true }));
  assert.equal(await readFile(saved, "utf8"), "BYTES");
});

test("downloading refuses a path outside the root", async (t) => {
  const store = await storage(Buffer.from("ATTACKER"));
  t.after(() => store.close());
  const root = await scratch(t);
  const elsewhere = await scratch(t);
  const target = join(elsewhere, ".zshenv");

  const result = await tool(
    "weeek_get_attachment",
    { [META_PATH]: meta("a.png", store.url) },
    [],
    root,
  ).handler({ fileId: "f-1", saveTo: target });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /outside/);
  // The file did not exist, which is exactly the case 73220fd left open: ~/.zshenv is usually
  // absent and is read by every zsh that starts, interactive or not.
  assert.deepEqual(await readdir(elsewhere), []);
});

test("downloading resolves the parent directory, so a symlinked folder cannot lead out", async (t) => {
  const store = await storage(Buffer.from("ATTACKER"));
  t.after(() => store.close());
  const root = await scratch(t);
  const elsewhere = await scratch(t);
  const decoy = join(root, "downloads");
  await symlink(elsewhere, decoy);

  const result = await tool(
    "weeek_get_attachment",
    { [META_PATH]: meta("a.png", store.url) },
    [],
    root,
  ).handler({ fileId: "f-1", saveTo: join(decoy, "note.txt") });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /outside/);
  assert.deepEqual(await readdir(elsewhere), []);
});

test("overwrite cannot follow a symlink out of the root", async (t) => {
  const store = await storage(Buffer.from("ATTACKER"));
  t.after(() => store.close());
  const root = await scratch(t);
  const elsewhere = await scratch(t);
  const victim = join(elsewhere, "id_rsa");
  await writeFile(victim, Buffer.from("PRIVATE KEY"));
  // The parent is inside the root; only the last component leads out. "wx" would refuse this on
  // its own with EEXIST, but "w" follows a symlink, so overwrite: true is the case that needs the
  // target resolved as well as its parent.
  const decoy = join(root, "note.txt");
  await symlink(victim, decoy);

  const result = await tool(
    "weeek_get_attachment",
    { [META_PATH]: meta("a.png", store.url) },
    [],
    root,
  ).handler({ fileId: "f-1", saveTo: decoy, overwrite: true });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /outside/);
  assert.equal(await readFile(victim, "utf8"), "PRIVATE KEY");
});

test("the path written and reported is where it resolves to, not how it was spelled", async (t) => {
  const store = await storage(Buffer.from("BYTES"));
  t.after(() => store.close());
  const root = await scratch(t);
  const real = join(root, "downloads");
  await mkdir(real);
  const shortcut = join(root, "shortcut");
  await symlink(real, shortcut);

  // Both sides of this symlink are inside the root, so nothing is refused — what is being pinned
  // is that the write goes to the directory that was checked rather than to the spelling that was
  // passed. It narrows the window in which a symlink swapped after the check could redirect the
  // write, and it makes savedTo name the file the caller can actually find.
  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("a.png", store.url) }, [], root).handler({
      fileId: "f-1",
      saveTo: join(shortcut, "note.txt"),
    }),
  );

  assert.equal(payload["savedTo"], join(real, "note.txt"));
  assert.equal(await readFile(join(real, "note.txt"), "utf8"), "BYTES");
});

test("a name Weeek chose cannot start with a dot", async (t) => {
  const store = await storage(Buffer.from("ATTACKER"));
  t.after(() => store.close());
  const root = await scratch(t);

  // Inside the root and perfectly ordinary as a request — "save this attachment into my project".
  // The name is the attacker's, and .envrc is executed by direnv on the next cd into the folder.
  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta(".envrc", store.url) }, [], root).handler(
      { fileId: "f-1", saveTo: root },
    ),
  );

  assert.equal(payload["savedTo"], join(root, "attachment-.envrc"));
  assert.deepEqual(await readdir(root), ["attachment-.envrc"]);
});

test("a leading dot is taken off the magic, not off the name", () => {
  assert.equal(safeFileName(".envrc"), "attachment-.envrc");
  assert.equal(safeFileName(".zshenv"), "attachment-.zshenv");
  assert.equal(safeFileName("a/b/.gitconfig"), "attachment-.gitconfig");
  // Still a name, and still the one Weeek gave, so an ordinary file is untouched.
  assert.equal(safeFileName("notes.md"), "notes.md");
  assert.equal(safeFileName("archive.tar.gz"), "archive.tar.gz");
});

test("a caller-named path gets the leading-dot rule too", async (t) => {
  const store = await storage(Buffer.from("ATTACKER"));
  t.after(() => store.close());
  const root = await scratch(t);

  // The rule used to be tied to where the name came from rather than to the name. An attachment
  // called .envrc became attachment-.envrc, while "save it to <root>/.envrc" wrote .envrc verbatim
  // — and the caller here is a model that has just been reading other people's comments, so which
  // side supplied the name says nothing about whether it is safe. The root is an ordinary project
  // directory, the one the README tells you to pick, and direnv runs .envrc at the next cd.
  const payload = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("a.png", store.url) }, [], root).handler({
      fileId: "f-1",
      saveTo: join(root, ".envrc"),
    }),
  );

  assert.equal(payload["savedTo"], join(root, "attachment-.envrc"));
  assert.deepEqual(await readdir(root), ["attachment-.envrc"]);
});

test("both name branches land on the same rule", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const root = await scratch(t);

  // The same dotfile, once as the name Weeek reports and once as the path the caller names. One
  // rule means one answer; that they agree is the property, not either name on its own.
  const named = payloadOf(
    await tool("weeek_get_attachment", { [META_PATH]: meta("x.png", store.url) }, [], root).handler({
      fileId: "f-1",
      saveTo: join(root, ".zshenv"),
    }),
  );
  const supplied = payloadOf(
    await tool(
      "weeek_get_attachment",
      { [META_PATH]: meta(".zshenv", store.url) },
      [],
      root,
    ).handler({ fileId: "f-2", saveTo: root, overwrite: true }),
  );

  assert.equal(basename(String(named["savedTo"])), "attachment-.zshenv");
  assert.equal(basename(String(supplied["savedTo"])), "attachment-.zshenv");
});

test("a root wide enough to warn about says so in the answers, not only on stderr", async (t) => {
  const store = await storage(Buffer.from("x"));
  t.after(() => store.close());
  const root = await scratch(t);
  const source = join(root, "a.txt");
  await writeFile(source, Buffer.from("x"));
  const warning = "WEEEK_FILE_ROOT is /Users/you, your home directory.";

  // stderr from a stdio server is the channel a person is least likely to be reading — Claude Code
  // files it into a log — so the one place the sentence reliably reaches somebody is the
  // transcript. Repeated on every call, deliberately: state is how "shown once" becomes "shown
  // never", and the person paying for the repetition is the one running the widest configuration.
  const downloaded = payloadOf(
    await attachmentTools({ [META_PATH]: meta("a.png", store.url) }, [], root, warning)
      .get("weeek_get_attachment")!
      .handler({ fileId: "f-1" }),
  );
  const uploaded = payloadOf(
    await attachmentTools({ [UPLOAD_PATH]: { success: true } }, [], root, warning)
      .get("weeek_upload_attachment")!
      .handler({ taskId: 7197, filePath: source }),
  );

  t.after(() => rm(dirname(String(downloaded["savedTo"])), { recursive: true, force: true }));
  assert.equal(downloaded["warning"], warning);
  assert.equal(uploaded["warning"], warning);

  // And nothing extra when there is nothing to say.
  const quiet = payloadOf(
    await tool("weeek_upload_attachment", { [UPLOAD_PATH]: { success: true } }, [], root).handler({
      taskId: 7197,
      filePath: source,
    }),
  );
  assert.equal("warning" in quiet, false);
});
