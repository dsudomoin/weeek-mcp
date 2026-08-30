import { marked } from "marked";
import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Weeek stores <table>, and turndown on its own emits every cell as a separate paragraph, which
// destroys the association between a value and its column. Only the plugin's table rule is taken:
// its strikethrough emits a single tilde rather than the conventional double, so ours is below.
turndown.use(tables);

// Both the plugin's table rule and the keep filter it registers read node.rows[0] without checking
// that a row exists, and then dereference it — so a rowless <table> throws and takes the whole
// description with it. TABLE counts as meaningful when blank, so turndown's blank-node shortcut
// does not step in either. This must be registered after use(tables): addRule unshifts, and
// turndown consults the rule array before the keep filters, so the guard is reached first.
turndown.addRule("rowlessTable", {
  filter: (node) => node.nodeName === "TABLE" && node.rows.length === 0,
  replacement: (content) => content,
});

// Turndown core has no rule for <del>, <s> or <strike>, so it unwraps the tag and emits the content
// as ordinary prose — a struck-out requirement reaches the model indistinguishable from a live one.
// Weeek normalises <s> into <del>; the deprecated <strike> is covered on the same reasoning.
turndown.addRule("strikethrough", {
  filter: ["del", "s", "strike"],
  replacement: (content) => `~~${content}~~`,
});

// Turndown escapes _, * and \ anywhere it finds them in text, so handle_task_event comes back as
// handle\_task\_event and C:\Users\dev as C:\\Users\\dev. A description is read by a model and
// never parsed as markdown again, so a corrupted identifier or path costs more than a literal
// pair of asterisks being taken for bold.
turndown.escape = (text: string): string => text;

/**
 * Converts a description written in markdown to the HTML Weeek stores.
 *
 * Two of Weeek's habits delete a user's content here, and both are worked around rather than
 * reported, because neither of them produces an error to report:
 *
 * - Bare newlines are dropped, so "line one\n\nline two" is stored as "<p>line onelinetwo</p>".
 *   `breaks: true` is what turns a line break into a tag that survives that.
 * - A `<pre>` element is discarded whole, which would take every code block with it. See
 *   {@link promoteCodeBlocks}.
 */
export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, breaks: true, gfm: true });
  return promoteCodeBlocks(html).trim();
}

/** Renders a stored description, which Weeek keeps as HTML, back into readable markdown. */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

/**
 * Rewrites the code blocks marked emits into the one shape Weeek keeps.
 *
 * Weeek discards a `<pre>` element from a description outright, but accepts a `<code>` and promotes
 * it back to a block, newlines intact. marked emits `<pre><code>`, so without this every fenced and
 * indented code block would silently vanish from the description. The language class goes with it
 * because Weeek ignores it, and the trailing newline because marked always appends one.
 *
 * The pattern runs over marked's own output. In the code blocks marked generates, both the content
 * and the language class are escaped, so neither the closing sequence nor a `>` can occur inside
 * one and the lazy match cannot end early. That reasoning does not extend to raw HTML, which marked
 * passes through unescaped: a hand-written `<pre><code` inside an HTML comment can open a match
 * that runs on into the next real block.
 */
function promoteCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g,
    (_match: string, code: string) => `<p><code>${code.replace(/\n$/, "")}</code></p>`,
  );
}
