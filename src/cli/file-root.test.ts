import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { interpretRoot } from "./file-root.ts";

// A real directory tree, because every interesting answer here turns on what is actually on disk —
// a directory, a file, a symlink, nothing at all — and a stubbed stat would only be testing the
// stub. It is made once: nothing below writes into it.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "weeek-root-")));
const directory = join(scratch, "files");
const file = join(scratch, "notes.txt");
mkdirSync(directory);
writeFileSync(file, "");

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

test("an empty answer is a decision rather than a failure", () => {
  assert.deepEqual(interpretRoot(""), { kind: "none" });
  assert.deepEqual(interpretRoot("   "), { kind: "none" });
});

test("a directory that is there is accepted, resolved, and carries no warning", () => {
  assert.deepEqual(interpretRoot(directory, scratch), {
    kind: "ok",
    path: directory,
    warning: null,
  });
});

test("a trailing separator and a .. are normalised away before anything is stored", () => {
  // The value written into a client's configuration is compared against later — by the wizard, to
  // decide there is nothing to do, and by anyone reading it. Two spellings of one directory would
  // make "already set" false while the boundary was identical.
  assert.deepEqual(interpretRoot(`${directory}/`, scratch), {
    kind: "ok",
    path: directory,
    warning: null,
  });
  assert.deepEqual(interpretRoot(join(directory, "..", "files"), scratch), {
    kind: "ok",
    path: directory,
    warning: null,
  });
});

test("a relative path is refused rather than resolved against whatever directory you stand in", () => {
  // The one check stricter than the server's, and the reason is in the message: the server resolves
  // against its own working directory, which its client chooses. Accepting "files" here would store
  // a value that means one directory to the person typing it and another to the server.
  const refused = interpretRoot("files", scratch);

  assert.equal(refused.kind, "refused");
  assert.match(refused.why, /relative/);
});

test("a leading tilde is expanded, because no shell was here to do it", () => {
  assert.deepEqual(interpretRoot("~/files", scratch), {
    kind: "ok",
    path: directory,
    warning: null,
  });
  assert.equal(interpretRoot("~", scratch).kind, "ok");
});

test("a path that is not there yet is reported as absent, with the path to create", () => {
  const missing = join(scratch, "not-yet");

  assert.deepEqual(interpretRoot(missing, scratch), { kind: "absent", path: missing });
});

test("a file is refused, because this names the directory files go in", () => {
  const refused = interpretRoot(file, scratch);

  assert.equal(refused.kind, "refused");
  assert.match(refused.why, /not a directory/);
});

test("a filesystem root is refused, the same refusal the server makes", () => {
  const refused = interpretRoot(parse(scratch).root, scratch);

  assert.equal(refused.kind, "refused");
  assert.match(refused.why, /filesystem root/);
});

test("the home directory is accepted and warned about, not refused", () => {
  // The boundary is the operator's to draw. This is only so that it is a boundary they know they
  // drew — the same sentence the server prints at every start, said while they can still change it.
  const home = interpretRoot(scratch, scratch);

  assert.equal(home.kind, "ok");
  assert.ok(home.warning !== null, "the home directory drew no warning");
  assert.match(home.warning, /home directory/);
});
