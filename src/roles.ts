/**
 * omp model role aliases and thinking-effort levels.
 *
 * Verified against omp's real `modelRoles` set (docs/models.md) — note this
 * includes `vision / designer / task`, which the original PRD omitted.
 */

export const ROLES = [
  "default",
  "smol",
  "slow",
  "vision",
  "plan",
  "designer",
  "commit",
  "task",
] as const;

export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/** Thinking-effort selectors, verified against omp docs/models.md. */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_SET: ReadonlySet<string> = new Set(THINKING_LEVELS);

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_SET.has(value);
}
