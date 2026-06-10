/**
 * Built-in profiles that always exist regardless of what's on disk.
 */
import type { Profile } from "./schema.js";

export const EMPTY_PROFILE_NAME = "empty";

/**
 * Minimal set of essential tools kept active by the empty profile. Chosen to
 * leave the agent barely operable (read/inspect/edit/run) while every optional
 * and MCP-backed tool is stripped, so a misbehaving tool/MCP can be isolated.
 */
export const EMPTY_PROFILE_TOOLS = ["read", "write", "edit", "bash"] as const;

/**
 * The empty profile (PRD §4.7): disables all MCP servers and custom tools,
 * keeps only minimal model routing (no modelRoles => falls back to default).
 */
export function emptyProfile(): Profile {
  return {
    name: EMPTY_PROFILE_NAME,
    description:
      "Troubleshooting profile — disables all MCP servers and custom tools, keeps a minimal tool set.",
    tools: [...EMPTY_PROFILE_TOOLS],
    mcp: { enabled: [] },
    rules: [],
  };
}

/** Names reserved for built-ins; user profiles may not overwrite them on disk. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([EMPTY_PROFILE_NAME]);

export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.has(name);
}
