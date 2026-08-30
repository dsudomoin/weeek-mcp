import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type CommentNode,
  type RawComment,
  buildCommentTree,
  renderCommentTree,
} from "./comments.ts";

function comment(id: number, parentId: number | null, createdAt: string): RawComment {
  return { id, parentId, authorId: "u-1", markdown: `text ${id}`, createdAt, updatedAt: createdAt };
}

function collectIds(nodes: readonly CommentNode[], into: number[] = []): number[] {
  for (const node of nodes) {
    into.push(node.id);
    collectIds(node.replies, into);
  }
  return into;
}

test("roots read oldest first, although the API answers newest first", () => {
  // GET /tm/tasks/{taskId}/comments sorts newest first, so a discussion read in arrival order
  // would run backwards.
  const tree = buildCommentTree([
    comment(3, null, "2026-08-24T10:00:00Z"),
    comment(1, null, "2026-08-22T10:00:00Z"),
  ]);

  assert.deepEqual(tree.map((node) => node.id), [1, 3]);
});

test("replies under one parent read oldest first as well", () => {
  const tree = buildCommentTree([
    comment(3, 1, "2026-08-24T10:00:00Z"),
    comment(2, 1, "2026-08-23T10:00:00Z"),
    comment(1, null, "2026-08-22T10:00:00Z"),
  ]);

  assert.deepEqual(tree[0]?.replies.map((node) => node.id), [2, 3]);
});

test("nesting is rebuilt at any depth, not just one level", () => {
  // Three levels seen on a live task: a reply to a reply to a comment.
  const tree = buildCommentTree([
    comment(1, null, "2026-08-22T10:00:00Z"),
    comment(2, 1, "2026-08-22T11:00:00Z"),
    comment(3, 2, "2026-08-22T12:00:00Z"),
  ]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.replies[0]?.id, 2);
  assert.equal(tree[0]?.replies[0]?.replies[0]?.id, 3);
});

test("a reply whose parent is on another page is kept and marked, never dropped", () => {
  // limit/offset paginate a newest-first list, so a reply can land on this page while the comment
  // it answers sits on the next one. Dropping it would delete a comment from the discussion.
  const tree = buildCommentTree([comment(5, 99, "2026-08-22T10:00:00Z")]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.id, 5);
  assert.equal(tree[0]?.orphaned, true);
});

test("a reply orphaned by paging keeps the parent id it points at", () => {
  // The id is what lets a reader go and fetch the missing parent, so it survives into the node.
  const tree = buildCommentTree([comment(5, 99, "2026-08-22T10:00:00Z")]);

  assert.equal(tree[0]?.parentId, 99);
});

test("a deleted parent leaves ordinary roots, a paged-away parent leaves marked ones", () => {
  // Deletion is not a cascade: Weeek keeps the replies of a deleted comment and re-parents them to
  // null, so they arrive indistinguishable from comments that never were replies. Only a parentId
  // still pointing at a comment that is not here means the page cut the thread in half, and only
  // that one gets the mark — marking both would blame paging for a deletion.
  const tree = buildCommentTree([
    comment(2, null, "2026-08-22T11:00:00Z"),
    comment(3, 99, "2026-08-22T12:00:00Z"),
  ]);

  assert.deepEqual(tree.map((node) => node.id), [2, 3]);
  assert.deepEqual(tree.map((node) => node.orphaned), [false, true]);
});

test("comments sharing a timestamp are not left in the API's newest-first order", () => {
  // Ties would otherwise keep the input order, which is the one order this file exists to undo.
  const tree = buildCommentTree([
    comment(2, null, "2026-08-22T10:00:00Z"),
    comment(1, null, "2026-08-22T10:00:00Z"),
  ]);

  assert.deepEqual(tree.map((node) => node.id), [1, 2]);
});

test("a cycle in the parent links surfaces at the root instead of dropping out of the tree", () => {
  // Weeek cannot produce this. Without the guard a cycle is not a hang but a disappearance: each
  // node's parent is inside the cycle, so none of them reaches the roots and the cycle — with
  // everything hanging below it — becomes unreachable. Verified against a guardless replica: these
  // two comments come back as an empty tree.
  const tree = buildCommentTree([
    comment(1, 2, "2026-08-22T10:00:00Z"),
    comment(2, 1, "2026-08-22T11:00:00Z"),
  ]);

  assert.deepEqual(tree.map((node) => node.id), [1, 2]);
});

test("a comment that is its own parent still shows up", () => {
  // The same disappearance in its smallest form: guardless, this one comment lands in its own
  // replies and the tree comes back empty.
  const tree = buildCommentTree([comment(1, 1, "2026-08-22T10:00:00Z")]);

  assert.deepEqual(tree.map((node) => node.id), [1]);
});

test("no comment is lost between the input and the tree", () => {
  const tree = buildCommentTree([
    comment(4, 99, "2026-08-22T13:00:00Z"),
    comment(3, 2, "2026-08-22T12:00:00Z"),
    comment(2, 1, "2026-08-22T11:00:00Z"),
    comment(1, null, "2026-08-22T10:00:00Z"),
  ]);

  assert.deepEqual(collectIds(tree).sort((left, right) => left - right), [1, 2, 3, 4]);
});

test("the render puts a name where the payload carries only an author uuid", () => {
  const tree = buildCommentTree([comment(1, null, "2026-08-22T10:00:00Z")]);

  const text = renderCommentTree(tree, (id) => (id === "u-1" ? "Anna P" : id));

  assert.match(text, /Anna P/);
  assert.doesNotMatch(text, /u-1/);
});

test("a reply is indented one level under the comment it answers", () => {
  const tree = buildCommentTree([
    comment(1, null, "2026-08-22T10:00:00Z"),
    comment(2, 1, "2026-08-22T11:00:00Z"),
  ]);

  const text = renderCommentTree(tree, () => "Anna P");

  assert.match(text, /^#1 — /m);
  assert.match(text, /^ {2}#2 — /m);
});

test("an orphaned reply says which comment it answers and that the comment is absent", () => {
  const tree = buildCommentTree([comment(5, 99, "2026-08-22T10:00:00Z")]);

  const text = renderCommentTree(tree, () => "Anna P");

  assert.match(text, /#99/);
  assert.match(text, /not on this page/);
});

test("a comment following a nested reply is still separated from it by a blank line", () => {
  // Without the blank line the next comment reads as more of the reply's text, at a different
  // indent and by a different author.
  const tree = buildCommentTree([
    comment(1, null, "2026-08-22T10:00:00Z"),
    comment(2, 1, "2026-08-22T11:00:00Z"),
    comment(3, null, "2026-08-22T12:00:00Z"),
  ]);

  const text = renderCommentTree(tree, () => "Anna P");

  assert.match(text, /^ {2}> text 2\n\n#3 — /m);
  assert.equal(text, text.trimEnd());
});

test("a multi-line comment keeps every line at its own indentation", () => {
  const tree = buildCommentTree([
    comment(1, null, "2026-08-22T10:00:00Z"),
    { ...comment(2, 1, "2026-08-22T11:00:00Z"), markdown: "line one\n\nline two" },
  ]);

  const text = renderCommentTree(tree, () => "Anna P");

  assert.match(text, /^ {2}> line one$/m);
  assert.match(text, /^ {2}> line two$/m);
  // The marker goes inside the indent, and an empty line inside a comment carries a bare marker
  // rather than a marker and a space. Nothing in this output ends in whitespace — a body line of
  // only spaces would keep them, because two trailing spaces are a hard line break in markdown.
  assert.match(text, /^ {2}>$/m);
  assert.doesNotMatch(text, /[ \t]+$/m);
});

test("a task with no comments renders as nothing at all", () => {
  assert.equal(renderCommentTree(buildCommentTree([]), () => "Anna P"), "");
});

test("a comment stored with a trailing newline does not open a second blank line", () => {
  // An editor leaves a newline at the end of the text; the blank line between two comments carries
  // meaning here, so there has to be exactly one of it.
  const tree = buildCommentTree([
    { ...comment(1, null, "2026-08-22T10:00:00Z"), markdown: "text 1\n" },
    comment(2, null, "2026-08-22T11:00:00Z"),
  ]);

  const text = renderCommentTree(tree, () => "Anna P");

  assert.match(text, /^> text 1\n\n#2 — /m);
  assert.doesNotMatch(text, /\n\n\n/);
});

test("a body line that mimics a header cannot pass for one, because the body is quoted", () => {
  // People cite comments by number in a tracker, so a line opening with #<id> is ordinary text
  // rather than a freak accident. Unquoted it reads as comment 91, written by an author called
  // "the retry budget" at a time of "it is the same knob." — an attribution nobody wrote.
  const tree = buildCommentTree([
    {
      ...comment(1, null, "2026-08-22T10:00:00Z"),
      markdown: "#91 — the retry budget, it is the same knob.",
    },
  ]);

  const text = renderCommentTree(tree, () => "Anna P");

  assert.match(text, /^> #91 — the retry budget/m);
  assert.doesNotMatch(text, /^#91 — /m);
});

test("the quote marker gives a comment's text an exact end", () => {
  // The blank line separates comments and also separates paragraphs inside one, so it cannot say
  // where a comment ends. The first line without a marker can.
  const tree = buildCommentTree([
    {
      ...comment(1, null, "2026-08-22T10:00:00Z"),
      markdown: "first paragraph\n\nsecond paragraph",
    },
    comment(2, null, "2026-08-22T11:00:00Z"),
  ]);

  const text = renderCommentTree(tree, () => "Anna P");

  assert.deepEqual(text.split("\n"), [
    "#1 — Anna P, 2026-08-22T10:00:00Z",
    "> first paragraph",
    ">",
    "> second paragraph",
    "",
    "#2 — Anna P, 2026-08-22T11:00:00Z",
    "> text 2",
  ]);
});

test("a subtree renders on its own when the top level starts deeper", () => {
  // `depth` is what lets a caller render one branch without the thread above it.
  const tree = buildCommentTree([
    comment(1, null, "2026-08-22T10:00:00Z"),
    comment(2, 1, "2026-08-22T11:00:00Z"),
  ]);

  const text = renderCommentTree(tree, () => "Anna P", 1);

  assert.match(text, /^ {2}#1 — /m);
  assert.match(text, /^ {2}> text 1$/m);
  assert.match(text, /^ {4}#2 — /m);
});

test("chronological order rests on the timestamp shape this endpoint sends", () => {
  // Comparing text orders these correctly only while every timestamp has one shape. Weeek is not
  // consistent between endpoints — comments answer "2026-08-24T10:38:00Z" while attachments answer
  // "2026-08-24T10:39:16+00:00" — and a mixed payload would sort wrongly with no symptom at all.
  // So the shape this file leans on is pinned here rather than left as a footnote.
  const tree = buildCommentTree([
    comment(4, null, "2026-08-25T00:00:00Z"),
    comment(3, null, "2026-08-24T23:59:59Z"),
    comment(2, null, "2026-08-24T10:38:00Z"),
    comment(1, null, "2026-08-24T09:59:59Z"),
  ]);

  assert.deepEqual(tree.map((node) => node.id), [1, 2, 3, 4]);
});
