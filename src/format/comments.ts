export type RawComment = {
  id: number;
  parentId: number | null;
  authorId: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
};

export type CommentNode = RawComment & {
  replies: CommentNode[];
  /** The parent is named but did not come with this page, so the reply is shown at the root. */
  orphaned: boolean;
};

/**
 * Rebuilds a discussion out of the flat list `GET /tm/tasks/{taskId}/comments` answers with.
 *
 * Three habits of that endpoint shape this:
 *
 * - It sorts newest first, so the tree is sorted rather than taken in arrival order.
 * - Nesting is of arbitrary depth, confirmed to three levels on a live task.
 * - `limit`/`offset` page over that newest-first list, so a reply can arrive while the comment it
 *   answers is still a page away. Such a reply is kept at the root and marked, never dropped.
 *
 * Deleting a comment is not a cascade: Weeek re-parents its replies to `null`, which lands them at
 * the root as ordinary comments, with nothing to mark.
 */
export function buildCommentTree(comments: readonly RawComment[]): CommentNode[] {
  const nodes = new Map<number, CommentNode>();
  for (const comment of comments) {
    nodes.set(comment.id, { ...comment, replies: [], orphaned: false });
  }

  const roots: CommentNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }

    const parent = nodes.get(node.parentId);

    if (parent === undefined) {
      node.orphaned = true;
      roots.push(node);
      continue;
    }

    if (createsCycle(node, parent, nodes)) {
      roots.push(node);
      continue;
    }

    parent.replies.push(node);
  }

  sortRecursively(roots);
  return roots;
}

/**
 * Walks the parent chain above `parent` to see whether it comes back to `node`.
 *
 * Weeek cannot produce a cycle, and this is not here to repair one. What it prevents is a silent
 * loss, not a hang: every node of a cycle has its parent inside that cycle, so each one is pushed
 * into another cycle node's `replies` and not one of them ever reaches `roots`. The cycle, and
 * everything hanging below it, would drop out of the tree with nothing to show for it. Measured on
 * a replica without this guard: two comments in a cycle come back as an empty tree, and so does a
 * chain of five whose top three form one. Breaking the link puts those comments back at the root.
 * A page holds at most 100 comments, so walking the chain per node stays trivial.
 */
function createsCycle(
  node: CommentNode,
  parent: CommentNode,
  nodes: ReadonlyMap<number, CommentNode>,
): boolean {
  const seen = new Set<number>([node.id]);
  let current: CommentNode | undefined = parent;

  while (current !== undefined) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = current.parentId === null ? undefined : nodes.get(current.parentId);
  }

  return false;
}

function sortRecursively(nodes: CommentNode[]): void {
  nodes.sort(byCreation);
  for (const node of nodes) sortRecursively(node.replies);
}

function byCreation(left: CommentNode, right: CommentNode): number {
  // Text comparison orders ISO-8601 timestamps chronologically while their shape is uniform, which
  // is how they arrive. Date.parse would buy no ordering this needs and would add NaN as a way for
  // an unexpected timestamp to scramble a thread silently.
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;

  // Array#sort is stable and the input arrives newest first, so two comments written within the
  // same second would otherwise keep exactly the order this function exists to undo.
  return left.id - right.id;
}

/**
 * Renders a discussion as indented text, for a reader that has only the text to go on.
 *
 * Every line carries something a question about the thread can need: who wrote a comment, when, the
 * id to answer or delete it by, and — through the indentation — what it is a reply to. The text of
 * a comment is quoted, which is what keeps it from being read as any of those. `depth` sets the
 * indentation the top level starts at, so a subtree can be rendered on its own.
 */
export function renderCommentTree(
  nodes: readonly CommentNode[],
  authorName: (id: string) => string,
  depth = 0,
): string {
  const lines: string[] = [];
  appendNodes(nodes, authorName, depth, lines);
  return lines.join("\n").trimEnd();
}

// The whole thread is appended into one array rather than joining a string per level: a level that
// returned a trimmed string of its own would drop the blank line between its last reply and the
// next comment, which is the line that keeps the two apart.
function appendNodes(
  nodes: readonly CommentNode[],
  authorName: (id: string) => string,
  depth: number,
  lines: string[],
): void {
  const indent = "  ".repeat(depth);

  for (const node of nodes) {
    const orphanMark = node.orphaned
      ? ` · reply to #${node.parentId}, which is not on this page`
      : "";

    lines.push(
      `${indent}#${node.id} — ${authorName(node.authorId)}, ${node.createdAt}${orphanMark}`,
    );
    // The text is quoted rather than printed bare. People cite comments by number, so a body line
    // opening with "#91 — " would read as a header — an author and a time nobody wrote — and the
    // blank line cannot mark where a comment ends, since it separates paragraphs inside one too.
    // A quoted body settles both: it can never open with "#", and the first line without a marker
    // is the end of the text. The marker sits inside the indent, so a reply reads "  > text", and
    // an empty line carries a bare marker rather than a marker with a space after it. A line of
    // only spaces keeps those spaces: two of them are a hard line break in markdown, and inside a
    // fenced block they are content.
    //
    // Only the trailing newlines go: the blank line below separates this comment from the next,
    // and a text stored with a newline at the end would open a second one. Leading whitespace
    // stays, since four spaces on the first line are an indented code block.
    for (const line of node.markdown.trimEnd().split("\n")) {
      lines.push(line === "" ? `${indent}>` : `${indent}> ${line}`);
    }
    lines.push("");

    appendNodes(node.replies, authorName, depth + 1, lines);
  }
}
