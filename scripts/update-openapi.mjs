// Refreshes src/generated/weeek-openapi.ts, the committed snapshot of Weeek's API description.
//
//   npm run update:openapi
//
// THIS SCRIPT DOWNLOADS AND EXECUTES JAVASCRIPT FROM developers.weeek.net. The specification is
// not served as data anywhere; it exists only as a module of the documentation site, and the only
// way to read it is to run it. Nothing sandboxes that module here — it gets the same process, the
// same filesystem and the same network as this script. That is tolerable because this is a manual
// development command, run by a person who then reads the diff before committing it, and never
// part of the build, the tests or anything a user of the package runs. Read the diff.
//
// Why a snapshot rather than fetching at startup: the server would otherwise depend on a
// documentation site being up, and on the shape of a chunk that is rebuilt on every Weeek deploy,
// on the hot path of every client launch. Committed, the tool list is a reviewable artefact — a
// renamed tool or a vanished endpoint shows up as a diff before it reaches anyone.
//
// Nothing below is hardcoded except the documentation root, because nothing below can be. Weeek
// publishes no openapi.json — asking for one returns the portal's HTML shell — and every asset
// filename carries a content hash that changes on each deploy. So the chain is discovered at run
// time, three fetches deep:
//
//   1. the docs page references an entry bundle, /assets/entry.client-<hash>.js
//   2. that bundle dynamically imports the spec module, ./weeek.yaml-<hash>.js
//   3. that module's source map carries the module unminified, which is what we evaluate
//
// Step 3 is a shortcut worth naming: the chunk itself is minified, and its source map's
// sourcesContent holds the original text of the same module. Both evaluate to the same exports, so
// we take the readable one when it is there — it is what a human sees when checking what this
// script just ran — and fall back to the chunk when it is not.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DOCS_URL = "https://developers.weeek.net/";

// The five this server can actually issue, in the order WeeekOperation's HttpMethod lists them.
// Operations are emitted in this order within a path rather than in the order the document happens
// to key them, so that the snapshot does not reshuffle when upstream reorders a path item. Anything
// else a path item may carry — `parameters`, `summary`, a `servers` override — is not a method and
// must not be read as one.
const METHODS = ["get", "post", "put", "patch", "delete"];

// Keys thrown away wherever they appear inside a schema.
//
// `__$ref` is not Weeek's; it is the marker the docs site's build leaves on the objects it shares
// (see resolveRefs below). The rest are sample data and mock-generator hints — `faker` is a
// Stoplight extension, `x-examples` and `x-stoplight` are its editor's leftovers. None of them
// constrains an argument, no MCP client reads them, and they are a large share of the bytes: this
// file is bundled into the published server, where size is startup latency.
const DROPPED_SCHEMA_KEYS = new Set(["__$ref", "example", "examples", "faker"]);

// Defects in the published document, corrected on the way through, by exact match so that a
// correction cannot quietly start rewriting something it was never meant to touch.
//
// /crm/statuses{id} is missing a slash and would build a request to a URL that does not exist. The
// sibling routes (/crm/funnels/{funnelId}/statuses) and the endpoint's own documentation both say
// the segment is there. Every correction here has to still apply on each refresh — see below —
// so that this table shrinks when Weeek fixes something rather than outliving it.
const PATH_CORRECTIONS = new Map([["/crm/statuses{id}", "/crm/statuses/{id}"]]);

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const outputPath = resolve(repoRoot, "src/generated/weeek-openapi.ts");

const specModuleUrl = await discoverSpecModuleUrl();
const schema = await loadSchema(specModuleUrl);
const operations = collectOperations(schema);

writeFileSync(outputPath, render(schema, specModuleUrl, operations));

console.log(specModuleUrl);
console.log(`${Object.keys(schema.paths).length} paths, ${operations.length} operations -> ${outputPath}`);

async function fetchText(url, what) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${what}: ${url} returned ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

/**
 * Walks the docs page down to the URL of the chunk holding the specification.
 *
 * Each hop looks for one filename pattern and insists on exactly one match. A hop that suddenly
 * matches nothing means the site was rebuilt in a shape this no longer understands; a hop that
 * matches several means guessing which one is the spec, and guessing wrong here produces a
 * plausible-looking snapshot of the wrong document. Both are worth stopping for.
 */
async function discoverSpecModuleUrl() {
  const page = await fetchText(DOCS_URL, "documentation page");
  const entryPattern = /[^"'\s()]*\/assets\/entry\.client-[A-Za-z0-9_-]+\.js/g;
  const entryPath = onlyMatch(page, entryPattern, "entry bundle", DOCS_URL);
  const entryUrl = new URL(entryPath, DOCS_URL).href;

  const bundle = await fetchText(entryUrl, "entry bundle");
  // Sits in a dynamic import — `import("./weeek.yaml-<hash>.js")` — so it is relative to the
  // bundle, not to the site root, and has to resolve against the bundle's own URL.
  const chunkPattern = /[^"'\s()]*weeek\.yaml-[A-Za-z0-9_-]+\.js/g;
  const chunkPath = onlyMatch(bundle, chunkPattern, "specification chunk", entryUrl);
  return new URL(chunkPath, entryUrl).href;
}

function onlyMatch(text, pattern, what, where) {
  const found = [...new Set(text.match(pattern) ?? [])];
  if (found.length === 1) return found[0];
  throw new Error(
    found.length === 0
      ? `no ${what} found in ${where}; the documentation site's build has changed shape`
      : `${found.length} candidates for the ${what} in ${where}, cannot tell which is meant: ${found.join(", ")}`,
  );
}

/** Evaluates the spec module and returns its `schema` export. */
async function loadSchema(specModuleUrl) {
  const source =
    (await readableSource(specModuleUrl)) ?? (await fetchText(specModuleUrl, "specification chunk"));

  // An ES module in a string, and `import` only takes a URL — so the source becomes the URL. base64
  // rather than a plain data: URL because the module is a third of a megabyte of arbitrary text,
  // and percent-encoding every character that would otherwise terminate the URL is the same work
  // done less reliably.
  const encoded = Buffer.from(source, "utf8").toString("base64");

  let schema;
  try {
    ({ schema } = await import(`data:text/javascript;base64,${encoded}`));
  } catch (cause) {
    // Most likely the site answered with its HTML shell instead of the chunk, which parses as
    // neither JavaScript nor an error worth reading. Say which URL, and what it actually returned.
    throw new Error(
      `${specModuleUrl} did not evaluate as a module; it begins ${JSON.stringify(source.slice(0, 60))}`,
      { cause },
    );
  }

  if (schema?.paths === undefined) {
    throw new Error(`${specModuleUrl} evaluated but exports no schema.paths`);
  }
  return schema;
}

/**
 * The module before minification, from its source map, or undefined if there is no usable map.
 *
 * Nothing here treats a reply as a source map until it has parsed as one. The docs site is a single
 * page app: asking it for a file it does not have gets 200 and the page's HTML, not a 404 — that is
 * the whole reason this script exists rather than a fetch of openapi.json — and it answers for
 * .map the same way. So an unparseable or shapeless reply is a missing map, not a crash, and the
 * caller falls back to the minified chunk, which carries the same exports.
 */
async function readableSource(specModuleUrl) {
  const response = await fetch(`${specModuleUrl}.map`);
  if (!response.ok) return undefined;

  let map;
  try {
    map = JSON.parse(await response.text());
  } catch {
    return undefined;
  }

  const source = map?.sourcesContent?.[0];
  return typeof source === "string" && source.length > 0 ? source : undefined;
}

function collectOperations(schema) {
  const operations = [];
  const usedNames = new Map();
  const appliedCorrections = new Set();

  for (const [rawPath, pathItem] of Object.entries(schema.paths)) {
    const corrected = PATH_CORRECTIONS.get(rawPath);
    if (corrected !== undefined) appliedCorrections.add(rawPath);

    // Parameters declared on the path item belong to every operation under it, and Weeek uses this
    // for the path's own id — so they go first, ahead of what the operation adds for itself.
    const shared = pathItem.parameters ?? [];

    for (const method of METHODS) {
      const operation = pathItem[method];
      if (operation === undefined) continue;

      operations.push(describeOperation(operation, corrected ?? rawPath, method, shared, usedNames));
    }
  }

  for (const rawPath of PATH_CORRECTIONS.keys()) {
    // A correction that no longer matches anything has either been fixed upstream or was aimed at a
    // path that has since been renamed. Either way the table is now lying about the document, and
    // the entry needs removing by hand rather than sitting here doing nothing.
    if (!appliedCorrections.has(rawPath)) {
      throw new Error(`PATH_CORRECTIONS still lists ${rawPath}, which the specification no longer contains`);
    }
  }

  return operations;
}

function describeOperation(operation, path, method, sharedParameters, usedNames) {
  const entry = {
    name: toolName(operation.summary, path, method, usedNames),
    method: method.toUpperCase(),
    path,
    summary: operation.summary,
  };

  // Weeek writes "" rather than omitting the key on the operations that have nothing to say, and
  // an empty description is worse than none: it costs bytes in every tool listing and tells a
  // model nothing. Same reasoning for the parameter descriptions below.
  if (operation.description) entry.description = operation.description;

  entry.tags = [...(operation.tags ?? [])];
  entry.parameters = [...sharedParameters, ...(operation.parameters ?? [])].map(describeParameter);

  const requestBody = describeRequestBody(operation.requestBody);
  if (requestBody !== undefined) entry.requestBody = requestBody;

  return entry;
}

function describeParameter(parameter) {
  const described = {
    name: parameter.name,
    in: parameter.in,
    // Absent means not required, per OpenAPI. Written out rather than left off so that consumers
    // never have to know that, and so the two spellings of "optional" collapse into one.
    required: parameter.required === true,
  };

  if (parameter.description) described.description = parameter.description;
  described.schema = resolveRefs(parameter.schema ?? {});
  return described;
}

function describeRequestBody(requestBody) {
  if (requestBody === undefined) return undefined;

  // One media type per body throughout this API, and the alternative — carrying every variant —
  // would need a tool schema per content type. The first is the one we send.
  const [contentType, media] = Object.entries(requestBody.content ?? {})[0] ?? [];
  if (contentType === undefined) return undefined;

  return {
    required: requestBody.required === true,
    contentType,
    schema: resolveRefs(media.schema ?? {}),
  };
}

/**
 * Copies a schema into plain JSON, inlining the objects the docs site shares between $refs.
 *
 * The module is not a document with $ref pointers in it: its build resolved them, replacing each
 * pointer with the one object it pointed at, and recording where it came from in a `__$ref`
 * property that is non-enumerable — invisible to Object.entries, JSON.stringify and a spread. What
 * arrives is therefore a graph in which one schema object is reachable by many paths, and in
 * principle by a path through itself.
 *
 * Inlining, rather than putting the pointers back: what this file feeds is MCP tool schemas, and a
 * client validating one has no copy of the Weeek document to resolve a pointer against. A $ref
 * would be a dangling reference at the far end. Repetition costs bytes; a pointer nobody can follow
 * costs correctness.
 *
 * Which leaves the loop. Nothing in today's document is its own ancestor, so the guard below never
 * fires — but a schema that referred to itself, a task carrying its own subtasks, is an ordinary
 * thing for an API to grow, and it would turn this walk into an infinite one. There the pointer is
 * the only representable answer, so it is emitted; and a loop with no marker to emit cannot be
 * expressed at all, so it stops the run rather than producing a truncated schema that looks fine.
 */
function resolveRefs(node, ancestors = new Set()) {
  if (Array.isArray(node)) return node.map((item) => resolveRefs(item, ancestors));
  if (node === null || typeof node !== "object") return node;

  if (ancestors.has(node)) {
    if (typeof node.__$ref !== "string") {
      throw new Error("a schema refers to itself but carries no __$ref to point at");
    }
    return { $ref: node.__$ref };
  }

  ancestors.add(node);
  const copied = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_SCHEMA_KEYS.has(key) || key.startsWith("x-")) continue;
    copied[key] = resolveRefs(value, ancestors);
  }
  ancestors.delete(node);

  return copied;
}

/**
 * The tool name a model sees, built from the summary because that is the only thing every operation
 * has. Weeek gives fewer than a third of them an operationId, and the ones it does give are the
 * route spelled out — `get-ws`, `crm-patch-deal` — which is what `path` and `method` already say.
 *
 * Summaries repeat across sections: "Create a custom field" is a project's, a board's and a funnel's.
 * They are numbered in the order they are emitted, which is why METHODS above is a fixed order —
 * a name is a published identifier, and it must not move because upstream reordered a path item.
 */
function toolName(summary, path, method, usedNames) {
  const base = String(summary ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base === "") {
    throw new Error(`${method.toUpperCase()} ${path} has no summary to name a tool after`);
  }

  const seen = (usedNames.get(base) ?? 0) + 1;
  usedNames.set(base, seen);

  return `weeek_${base}${seen > 1 ? `_${seen}` : ""}`;
}

function render(schema, specModuleUrl, operations) {
  const baseUrl = schema.servers?.[0]?.url;
  if (typeof baseUrl !== "string") {
    throw new Error("the specification declares no servers[0].url to send requests to");
  }

  // JSON rather than TypeScript object literals for the operations: this is data, it is 6000 lines
  // of it, and a diff of quoted keys against quoted keys is the same diff every time. `as const`
  // narrows the literals so the tool layer can read paths and methods as types; `satisfies` checks
  // the shape here instead of letting a malformed operation surface as an error at a use site.
  return `import type { WeeekOperation } from "../openapi-types.ts";

export const WEEEK_OPENAPI_SOURCE = {
  docs: ${JSON.stringify(DOCS_URL)},
  specModule: ${JSON.stringify(specModuleUrl)},
  baseUrl: ${JSON.stringify(baseUrl)},
  title: ${JSON.stringify(schema.info?.title ?? "")},
  version: ${JSON.stringify(schema.info?.version ?? "")},
} as const;

export const WEEEK_OPERATIONS = ${JSON.stringify(operations, null, 2)} as const satisfies readonly WeeekOperation[];
`;
}
