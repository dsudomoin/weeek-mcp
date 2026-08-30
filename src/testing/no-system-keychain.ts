export {};

/**
 * Puts a started server on a platform with no reachable credential store, so a test about stored
 * tokens cannot read or write the real one.
 *
 * Used as `node --import <this file> src/server.ts`, the same shape as unavailable-stdin.ts.
 *
 * **Why a subprocess needs this at all.** `secrets.test.ts` isolates itself by passing a platform
 * and an environment to `keychainChoice` directly — `"linux"` with no `DBUS_SESSION_BUS_ADDRESS` is
 * the one pair that reaches the file on any machine. A server test cannot do that: it starts a real
 * process, and that process reads `process.platform`, which on a developer's Mac means the login
 * keychain. Nothing in the environment can change that — the Security framework does not follow
 * `HOME`, so even an environment stripped to `PATH` still finds it.
 *
 * The failure that produced this file was not hypothetical. Once someone ran `weeek-mcp init` for
 * real, `npm test` began failing on their machine: the test asserting that a tokenless environment
 * is refused watched the server find their actual token and start normally, and hung until it timed
 * out. The suite was green only for people who had never used the product.
 *
 * So the platform is pinned here instead. `keychainChoice` then follows its D-Bus rule, finds no bus
 * in a test environment that never sets one, and answers that the keychain is not usable — the same
 * decision `scratchEnv()` relies on, reached the same way, in a process that would otherwise decide
 * differently. The keychain is not merely avoided; the code that would open one is never called.
 *
 * Nothing else in the server reads `process.platform`. `node:path` decides its flavour from the
 * real platform when it loads, so paths are unaffected.
 */
Object.defineProperty(process, "platform", {
  configurable: true,
  value: "linux",
});
