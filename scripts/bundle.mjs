// Builds what npm publishes, and nothing else.
//
//   npm run build              # writes ./dist, which is what goes in the tarball
//   npm run build -- <dir>     # writes elsewhere, for a check that must not touch the real one
//
// Why a bundle rather than shipping tsc's output and letting npm install five dependencies: this
// server is launched through `npx` on every client start, so the install is on the hot path.
// Measured, same machine, same fast link: tsc output pulls 105 packages and 35 MB and reaches
// tools/list in 5.0 s cold; the bundle pulls 4 packages and 2.5 MB and reaches it in 1.8-2.1 s.
// Codex's default startup timeout is a hard 10 s, so the difference is the margin. It also removes
// any chance of a transitive dependency changing between publication and the user's install.
//
// The package cannot be dependency-free: a .node binary cannot go inside an esbuild bundle, so
// @napi-rs/keyring stays a real dependency and npm fetches the one prebuilt binding for the
// platform. That is the whole of the tree besides us.
//
// What it costs: bundling makes us a redistributor. Those packages would otherwise be fetched by
// npm on the user's machine and never travel with us; here their code is inside the file we
// publish. Their licences all require the notice to accompany copies, and a bundler carries over
// only what is marked in source — almost every package keeps its notice in a LICENSE file the
// bundler never looks at. Hence THIRD-PARTY-NOTICES.md, generated from the same metafile that says
// what actually went in, committed so that a human reads the diff, and published in `files`.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const identityModule = resolve(repoRoot, "src/identity.ts");
// The repository root when invoked normally, so the bundle lands in ./dist and the notices file
// beside package.json. A scratch directory when the freshness test drives it.
const outputRoot = resolve(process.argv[2] ?? repoRoot);
const bundlePath = resolve(outputRoot, "dist/server.mjs");

const { name, version } = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

let substituted = false;

// src/identity.ts reads package.json from one directory up, which is right for src/ and for dist/
// and impossible here: the bundle ships alone, with no manifest beside it. So freeze the values it
// would have read into the output. A build's identity is fixed at build time anyway.
const inlineIdentity = {
  name: "inline-identity",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /identity\.ts$/ }, (args) => {
      // The filter is a suffix match over every file esbuild loads, dependencies included. Only
      // ours may be replaced; returning nothing hands the file back to the normal loader.
      if (args.path !== identityModule) return undefined;

      substituted = true;
      const identity = JSON.stringify({ name, version });
      return { loader: "ts", contents: `export function serverIdentity() { return ${identity}; }` };
    });
  },
};

// write: false so that nothing reaches the working tree until every check below has passed. A
// bundle written first and rejected afterwards leaves a broken server.mjs lying where the next
// `git add -A` would sweep it in.
const result = await build({
  entryPoints: ["src/server.ts"],
  outfile: bundlePath,
  // Set so that the entry point, and the module paths esbuild writes into the output as comments,
  // resolve against the repository rather than whatever directory this was invoked from.
  absWorkingDir: repoRoot,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // The one thing deliberately left outside the bundle. @napi-rs/keyring is a native binding, and
  // esbuild cannot bundle a .node file at all — it fails the build outright. Marked external, the
  // import survives as an import, src/secrets.ts loads it lazily inside a try/catch, and for this
  // build it simply never resolves: the plugin has no node_modules beside it. That is the intended
  // shape rather than a gap. The plugin route carries the token through its own userConfig, which
  // Claude Code keeps, so the bundle never needs a keychain — and because keyring's code never
  // enters the output, we do not redistribute it and THIRD-PARTY-NOTICES.md does not change.
  external: ["@napi-rs/keyring"],
  plugins: [inlineIdentity],
  metafile: true,
  write: false,
  // Deliberately no `banner`: esbuild already carries the entry point's own shebang to the top of
  // the bundle. A second one lands on line 2, where `#!` is a syntax error rather than a comment,
  // and the bundle fails to parse at all.
});

// Without this the substitution could stop matching — a rename, a move — and the only symptom
// would be a plugin that dies at startup on a machine nobody is watching, trying to read a
// package.json that was never shipped.
if (!substituted) {
  throw new Error(
    `inline-identity never matched ${identityModule}: the bundle would go out reading a manifest that is not shipped beside it`,
  );
}

const [output] = result.outputFiles;
if (output === undefined) throw new Error("esbuild produced no output file");

const notices = thirdPartyNotices(result.metafile);

// Emptied first, and this is not tidiness. `files: ["dist"]` publishes whatever is in that
// directory, so anything left there from an earlier build — a previous `tsc` emit, a renamed
// module — would ride into the tarball beside the one file that is actually run.
rmSync(dirname(bundlePath), { recursive: true, force: true });
mkdirSync(dirname(bundlePath), { recursive: true });
writeFileSync(bundlePath, output.contents);
// esbuild sets this itself when it writes a file starting with a shebang. We write the file, so
// we owe the mode: without it the committed bundle loses its executable bit.
chmodSync(bundlePath, 0o755);

// Committed at the repository root and published from there. LICENSE already lives there and is
// ours, so nothing is copied any more — only this one generated file is written.
writeFileSync(resolve(outputRoot, "THIRD-PARTY-NOTICES.md"), notices);

/** Every package whose code esbuild actually put in the output, as absolute directories. */
function bundledPackageDirs(metafile) {
  const marker = "node_modules/";
  const dirs = new Set();

  for (const input of Object.keys(metafile.inputs)) {
    // lastIndexOf, not indexOf: a nested node_modules means the innermost path is the real owner.
    const at = input.lastIndexOf(marker);
    if (at === -1) continue;

    const segments = input.slice(at + marker.length).split("/");
    const depth = segments[0]?.startsWith("@") ? 2 : 1;
    const relative = input.slice(0, at + marker.length) + segments.slice(0, depth).join("/");
    dirs.add(resolve(repoRoot, relative));
  }

  return [...dirs].sort();
}

function thirdPartyNotices(metafile) {
  const sections = bundledPackageDirs(metafile).map((dir) => {
    const manifest = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
    const licence = licenceTextFor(dir);

    // Loud rather than skipped. A package we cannot produce a notice for is exactly the case this
    // file exists to catch, and quietly leaving it out is the failure, not the fix.
    if (licence === undefined) {
      throw new Error(`${manifest.name} is in the bundle but has no licence file in ${dir}`);
    }
    if (licence.includes("```")) {
      throw new Error(
        `${manifest.name}'s licence contains a code fence, which would break the notices file`,
      );
    }

    const spdx = typeof manifest.license === "string" ? manifest.license : "see below";
    const heading = `## ${manifest.name} ${manifest.version} — ${spdx}`;
    return `${heading}\n\n\`\`\`\n${licence.trim()}\n\`\`\`\n`;
  });

  return `# Third-party notices

\`dist/server.mjs\`, the file this package publishes, is a single bundled file. It contains, in
compiled form, the packages listed below, and each one's licence is reproduced in full as those
licences require.

Generated by \`npm run build\` from the versions resolved in package-lock.json. Do not edit by
hand: it is rebuilt from whatever the bundle actually contains, and a test fails if the two drift.

${sections.join("\n")}`;
}

function licenceTextFor(packageDir) {
  const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING"];

  for (const filename of candidates) {
    const path = resolve(packageDir, filename);
    // Normalised to LF, because at least one of these files is not: domino's licence is CRLF, and
    // git stores what it commits as LF. Left alone, the committed notices and the ones this script
    // regenerates differ by 24 bytes on any fresh clone, and the freshness check fails for a reason
    // that has nothing to do with the bundle. Line endings are not part of a licence's text.
    if (existsSync(path)) return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
  }

  return undefined;
}
