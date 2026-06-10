/**
 * Directory-binding resolution and the documented precedence chain (PRD §4.6).
 *
 * Precedence, highest to lowest:
 *   1. CLI explicit flags                  (not applicable in pure /command form)
 *   2. Runtime `/profile` switch           (handled by the command layer)
 *   3. Directory-bound auto-activation     (this module: `matchBoundProfile`)
 *   4. Global default profile (~/.omp/agent) (omp itself; we never touch it)
 *
 * A profile's unset fields always fall back to the next level — which, for a
 * pure extension, means we simply do not override the corresponding session
 * setting (see apply.ts).
 *
 * This module is pure; `node:path` is standard-library, not a host dependency.
 */
import { resolve as resolvePath, sep } from "node:path";
import type { Profile } from "./schema.js";

/** Expand a leading "~" to the given home directory, then absolutize. */
export function normalizeDir(input: string, home: string): string {
  let p = input.trim();
  if (p === "~") p = home;
  else if (p.startsWith("~/") || p.startsWith(`~${sep}`)) p = home + sep + p.slice(2);
  return resolvePath(p);
}

/** True when `child` is `parent` itself or nested inside it. */
export function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const base = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(base);
}

export interface BoundMatch {
  name: string;
  /** The bound path that matched (normalized). */
  boundPath: string;
}

/**
 * Find the profile whose `boundPaths` best matches `cwd`. The longest (most
 * specific) matching bound path wins; ties resolve to the first profile in
 * input order for determinism.
 */
export function matchBoundProfile(
  profiles: readonly Profile[],
  cwd: string,
  home: string,
): BoundMatch | undefined {
  const target = resolvePath(cwd);
  let best: BoundMatch | undefined;
  let bestLen = -1;

  for (const profile of profiles) {
    for (const raw of profile.boundPaths ?? []) {
      const dir = normalizeDir(raw, home);
      if (isWithin(target, dir) && dir.length > bestLen) {
        best = { name: profile.name, boundPath: dir };
        bestLen = dir.length;
      }
    }
  }

  return best;
}
