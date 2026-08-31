import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileRootWarning, isFilesystemRoot } from "../config.ts";

/**
 * What the wizard makes of a typed answer to "which directory may the attachment tools touch".
 *
 * The checks here are deliberately the same ones the server applies to WEEEK_FILE_ROOT at startup,
 * reusing its own predicates rather than restating them: a wizard that accepted a value the server
 * then refuses would be worse than no wizard, because the refusal arrives in a log nobody reads,
 * hours later, at the moment somebody tries to attach a file.
 *
 * Two answers are not failures and are why this is a union rather than a throw. An empty answer is
 * a decision — both file tools stay refused, which is the safe default and the state most people
 * should stay in. A path that does not exist yet is the common case for a directory somebody is
 * creating *for* this purpose, and the caller offers to make it rather than sending them away to
 * run mkdir and start over.
 */
export type RootAnswer =
  | { kind: "none" }
  | { kind: "absent"; path: string }
  | { kind: "refused"; why: string }
  | { kind: "ok"; path: string; warning: string | null };

/**
 * Reads a typed answer, without touching the filesystem beyond looking.
 *
 * `home` is a parameter for the reason `isFilesystemRoot` takes a path flavour and `keychainChoice`
 * takes a platform: the home-directory branch is the one worth testing hardest, and a check that
 * only runs against the real $HOME of whoever runs the suite is not a check.
 */
export function interpretRoot(typed: string, home: string = homedir()): RootAnswer {
  const answer = typed.trim();
  if (answer === "") return { kind: "none" };

  // The shell never saw this string — the wizard read it from the terminal itself — so a leading
  // tilde arrives unexpanded and would otherwise be taken for a directory literally named "~".
  const expanded = expandHome(answer, home);

  // Relative paths are refused rather than resolved, and this is the one check that is stricter
  // than the server's. The server resolves against its own cwd, which an MCP client chooses: it is
  // $HOME in most Claude Code sessions and / under Codex. Resolving here against the cwd the
  // person happens to be standing in would agree with the server almost nowhere.
  if (!isAbsolute(expanded)) {
    return {
      kind: "refused",
      why:
        `${answer} is a relative path, and the server would resolve it against its own working ` +
        "directory rather than yours — which its client picks, and which is usually your home " +
        `directory or /. Give the whole path, starting at ${sep} or ~${sep}.`,
    };
  }

  const path = resolve(expanded);

  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return { kind: "absent", path };
  }

  if (!statSync(real).isDirectory()) {
    return {
      kind: "refused",
      why: `${path} is a file, not a directory. This names the directory files go in and come from.`,
    };
  }

  // The same refusal the server makes, for the same reason: far more often a variable that did not
  // expand than a decision anybody made, and the one shape the containment check cannot express.
  if (isFilesystemRoot(real)) {
    return {
      kind: "refused",
      why:
        `${path} is a filesystem root, which is not a restriction at all. Name the one directory ` +
        "the attachment tools should be able to reach.",
    };
  }

  // Stored as resolved rather than as the real path: a person who deliberately works through a
  // symlink should see back the path they named. The server realpaths it again before comparing
  // anything, so the boundary is identical either way.
  return { kind: "ok", path, warning: fileRootWarning(real, { HOME: home }) };
}

function expandHome(answer: string, home: string): string {
  if (answer === "~") return home;
  return answer.startsWith("~/") || answer.startsWith("~\\") ? join(home, answer.slice(2)) : answer;
}
