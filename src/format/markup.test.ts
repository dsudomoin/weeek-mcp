import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown, markdownToHtml } from "./markup.ts";

test("a single newline becomes a br tag", () => {
  // The newline character itself does not reach Weeek, so a line break only survives as a tag.
  assert.match(markdownToHtml("line one\nline two"), /<br\s*\/?>/);
});

test("the line structure survives Weeek deleting every newline from the HTML", () => {
  // Verified on the wire: "line one\n\nline two" is stored as "<p>line onelinetwo</p>".
  // Weeek strips the newlines out of a description with no error and no warning, so the test
  // reproduces that strip and checks that nothing was left leaning on a newline to stay apart.
  const stored = markdownToHtml("line one\nline two\n\nsecond paragraph").replaceAll("\n", "");

  assert.match(stored, /line one<br\s*\/?>line two/);
  assert.doesNotMatch(stored, /line oneline two/);
  assert.match(stored, /<p>second paragraph<\/p>/);
});

test("a blank line becomes a new paragraph and the HTML carries no stray whitespace", () => {
  // The newline left between the two tags is the harmless kind: the tags carry the structure,
  // so Weeek dropping it changes nothing.
  assert.equal(markdownToHtml("first\n\nsecond"), "<p>first</p>\n<p>second</p>");
});

test("markdown is converted to markup instead of being stored as literal text", () => {
  // Weeek does not parse markdown in a description: "**bold**" is stored with its asterisks.
  assert.match(markdownToHtml("**bold**"), /<strong>bold<\/strong>/);
});

test("a fenced code block leaves as code, because Weeek discards a pre element", () => {
  // Verified on the wire: Weeek drops <pre><code>…</code></pre> from a description outright, but
  // accepts a <code> and promotes it back to a block. marked emits exactly the form Weeek drops,
  // so a code block only survives the trip if it leaves here as <code>. The language class goes
  // too, because Weeek ignores it.
  assert.equal(
    markdownToHtml("```js\nconst a = 1;\nconst b = 2;\n```"),
    "<p><code>const a = 1;\nconst b = 2;</code></p>",
  );
});

test("a code block keeps its place among the paragraphs around it", () => {
  assert.equal(
    markdownToHtml("before\n\n```\ncode line\n```\n\nafter"),
    "<p>before</p>\n<p><code>code line</code></p>\n<p>after</p>",
  );
});

test("markup inside a code block stays escaped when the block is rewritten", () => {
  // The content arrives escaped by marked and is moved, never re-parsed. Unescaping it here would
  // turn a code sample in a description into live markup.
  assert.equal(
    markdownToHtml("```\n<b>not bold</b> & co\n```"),
    "<p><code>&lt;b&gt;not bold&lt;/b&gt; &amp; co</code></p>",
  );
});

test("a code block survives the trip to Weeek and reads back as a code block", () => {
  // Weeek promotes the <code> we send into a block <pre><code> above its own paragraph and keeps
  // the newlines inside it, leaving an empty paragraph behind — all verified on the wire.
  // Applying that promotion to what we send is the description the next read returns.
  const sent = markdownToHtml("```\nconst a = 1;\nconst b = 2;\n```");
  const stored = sent.replace(
    /^<p><code>([\s\S]*)<\/code><\/p>$/,
    "<pre><code>$1</code></pre>\n<p></p>",
  );

  // Without the rewrite there is no <code> to promote, and the round trip below would be vacuous.
  assert.notEqual(stored, sent);
  assert.equal(htmlToMarkdown(stored), "```\nconst a = 1;\nconst b = 2;\n```");
});

test("a real Weeek description reads back as markdown", () => {
  const markdown = htmlToMarkdown("<p>first paragraph<br>second line</p><ul><li>item</li></ul>");

  assert.match(markdown, /first paragraph/);
  assert.match(markdown, /second line/);
  assert.match(markdown, /- {1,3}item/);
});

test("a struck-out line reads as struck out, not as a live one", () => {
  // Turndown core has no rule for <del>, so it unwraps the tag and emits the content as ordinary
  // prose. A cancelled requirement then reaches the model indistinguishable from its live
  // neighbour, which is a silent wrong answer of exactly the kind this module exists to stop.
  assert.equal(
    htmlToMarkdown("<ul><li><del>ship the old API</del></li><li>ship the new API</li></ul>"),
    "-   ~~ship the old API~~\n-   ship the new API",
  );
  // Weeek normalises <s> to <del>, but all three spellings are accepted on the way in.
  assert.equal(htmlToMarkdown("<p><s>dropped</s> kept</p>"), "~~dropped~~ kept");
  assert.equal(htmlToMarkdown("<p><strike>old</strike> new</p>"), "~~old~~ new");
});

test("strikethrough is written with two tildes and reads back", () => {
  // The GFM plugin's own rule emits one tilde. Two is the conventional form and the one renderers
  // support universally, so that is what we emit; marked accepts either on the way back.
  const markdown = htmlToMarkdown("<p><del>dropped</del></p>");

  assert.equal(markdown, "~~dropped~~");
  assert.match(markdownToHtml(markdown), /<del>dropped<\/del>/);
});

test("a table keeps its columns instead of flattening into loose paragraphs", () => {
  // Weeek stores <table>, and turndown without the GFM table rule emits each cell as its own
  // paragraph — "env\n\nhost\n\nprod" — destroying which value belongs to which column.
  assert.equal(
    htmlToMarkdown(
      "<table><thead><tr><th>env</th><th>host</th></tr></thead>" +
        "<tbody><tr><td>prod</td><td>a.example</td></tr></tbody></table>",
    ),
    "| env | host |\n| --- | --- |\n| prod | a.example |",
  );
});

test("a table with no header row is preserved as HTML rather than flattened", () => {
  // The GFM rule only converts a table whose first row is a heading row, and deliberately keeps
  // any other table as raw HTML. That is verbose for a model to read but lossless, which is the
  // point: the column association survives either way.
  assert.equal(
    htmlToMarkdown("<table><tr><td>env</td><td>host</td></tr><tr><td>prod</td><td>a.example</td></tr></table>"),
    "<table><tbody><tr><td>env</td><td>host</td></tr><tr><td>prod</td><td>a.example</td></tr></tbody></table>",
  );
});

test("a table with no rows does not take the whole description down with it", () => {
  // Both the GFM table rule and the keep filter it registers call isHeadingRow(node.rows[0])
  // without checking that a first row exists, and turndown's blank-node shortcut does not save
  // them because TABLE counts as meaningful when blank. htmlToMarkdown is the read path for
  // whatever HTML is already in a user's workspace, so one pasted or half-deleted table would
  // otherwise turn an entire task read into a hard failure.
  assert.equal(htmlToMarkdown("<table></table>"), "");
  assert.equal(htmlToMarkdown("<table><caption>c</caption></table>"), "c");
  assert.equal(htmlToMarkdown("<table><thead></thead></table>"), "");
  // The surrounding prose is the point: a broken table must not cost the reader the rest.
  assert.equal(htmlToMarkdown("<p>before</p><table></table><p>after</p>"), "before\n\nafter");
});

test("headings are written in the atx form", () => {
  // The setext alternative underlines with dashes, which is indistinguishable from a horizontal
  // rule once the heading text wraps.
  assert.equal(htmlToMarkdown("<h2>Heading</h2>"), "## Heading");
});

test("leading whitespace from the editor does not survive into the output", () => {
  // A rich-text editor emits &nbsp; freely, and turndown renders it as U+00A0, which its own
  // output trim keeps: that strips only tabs and newlines from the front. U+00A0 does not indent
  // markdown the way a space would, so this is leading junk in the text rather than a code block,
  // and .trim() removes it because U+00A0 still counts as JavaScript whitespace.
  assert.equal(htmlToMarkdown("&nbsp;&nbsp;<p>first line</p>"), "first line");
});

test("text is not markdown-escaped, so identifiers and paths read back verbatim", () => {
  // Turndown escapes _, * and \ in text by default. The reader here is a model answering
  // questions about a description, and handle\_task\_event is the wrong identifier to hand it.
  assert.equal(
    htmlToMarkdown("<p>call handle_task_event, then read C:\\Users\\dev\\app.log</p>"),
    "call handle_task_event, then read C:\\Users\\dev\\app.log",
  );
});

test("a read-then-created description keeps its breaks even if trailing spaces are lost", () => {
  // Descriptions are read as markdown by one tool and written back as HTML by another, so a model
  // copying text between two tasks sends it through both. Turndown renders a <br> as two trailing
  // spaces, which anything tidying whitespace drops; the bare newline left behind only survives
  // because of breaks: true.
  const markdown = htmlToMarkdown("<p>step one<br>step two</p><p>step three</p>");
  const tidied = markdown.replace(/[ \t]+$/gm, "");
  const stored = markdownToHtml(tidied).replaceAll("\n", "");

  assert.match(stored, /step one<br\s*\/?>step two/);
  assert.match(stored, /<p>step three<\/p>/);
});

test("empty input converts to empty output", () => {
  assert.equal(markdownToHtml(""), "");
  assert.equal(htmlToMarkdown(""), "");
  // Blank text must not turn into an empty paragraph that Weeek would store as a description.
  assert.equal(markdownToHtml("   "), "");
  assert.equal(htmlToMarkdown("   "), "");
});
