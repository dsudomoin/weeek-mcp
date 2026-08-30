/**
 * turndown-plugin-gfm ships no type declarations.
 *
 * Only the table rule is declared, because it is the only one we use. The package also exports
 * `strikethrough`, `taskListItems`, `highlightedCodeBlock` and the combined `gfm`; its
 * strikethrough emits a single tilde (`~text~`) rather than the conventional `~~text~~`, so ours
 * is written by hand in markup.ts. Leaving the rest undeclared keeps them from being reached for
 * by accident.
 */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  export const tables: TurndownService.Plugin;
}
