export {};

/**
 * Takes `process.stdin` away, so a server started with
 * `node --import <this file> src/server.ts` fails on something nobody planned for.
 *
 * It exists for one test: the branch of `server.ts` that reports an unexpected failure in full
 * rather than as a single sentence. Nothing in the environment can reach that branch — every
 * startup failure a user can cause is a ConfigError, which is the whole reason the two are told
 * apart — so the unexpected error has to be introduced from outside the program.
 *
 * The getter answers undefined rather than throwing: a getter that throws fires far too early,
 * while node is building the ESM facade for `node:process` and copying its properties, and the
 * failure then escapes before main() exists to catch it. Answering undefined lets the stdio
 * transport dereference it instead, which is a TypeError from inside startup — exactly the shape
 * of the bug this branch is for.
 */
Object.defineProperty(process, "stdin", {
  configurable: true,
  get: () => undefined,
});
