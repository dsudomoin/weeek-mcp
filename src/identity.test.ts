import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { serverIdentity } from "./identity.ts";

test("the identity is the package manifest's, not a second copy of it", () => {
  // server.ts used to name the version itself, so a release bump could leave it behind and the
  // failure landed in a test that mentioned neither the version nor the reason. Comparing against
  // the manifest instead can only fail if someone writes a literal back in — a bump moves both
  // sides at once and this stays green.
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  const identity = serverIdentity();

  assert.equal(identity.name, manifest["name"]);
  assert.equal(identity.version, manifest["version"]);

  // Two fields and no more. Handed the parsed manifest whole, the SDK would put every dependency,
  // script and path in package.json into the initialize response.
  assert.deepEqual(Object.keys(identity).sort(), ["name", "version"]);
});
