import { readFileSync } from "node:fs";

/** The name and version a client is told during initialize. */
export type ServerIdentity = { name: string; version: string };

/**
 * Reads the server's identity from package.json, so that a release bump lands in one place.
 *
 * This path is taken only when the sources are run directly — `src/server.ts` under `node --test`,
 * where the manifest sits one directory up. It is not what a user runs.
 *
 * What a user runs is the published bundle, and that cannot read anything: `dist/server.mjs` is one
 * file, and although package.json does ship beside it in the tarball, the bundle is also executed
 * from npx's cache and from a global install, where nothing about the layout is ours to rely on.
 * `scripts/bundle.mjs` substitutes this module with the literal values at build time and fails the
 * build if that substitution ever stops matching, so the shipped identity is fixed when it is
 * built — which is what a build's identity is anyway.
 *
 * Only the two fields are copied out. Handing the parsed manifest to the SDK whole would put every
 * dependency, script and path in package.json into the initialize response.
 */
export function serverIdentity(): ServerIdentity {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as ServerIdentity;

  return { name: manifest.name, version: manifest.version };
}
