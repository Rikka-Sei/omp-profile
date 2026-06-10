/**
 * Profile data model + validation.
 *
 * A profile is a named environment bundle (PRD §4.1). It is stored as a single
 * YAML file. Any field left unset falls back to the next precedence level
 * (PRD §4.6) — so every field except `name` is optional.
 *
 * Validation is hand-rolled (zero runtime deps beyond YAML) and intentionally
 * lenient: unknown keys are ignored, recoverable issues become warnings, and
 * only structural violations become errors.
 */
import { isRole, type Role } from "./roles.js";

export interface ProfileMcp {
  /** MCP servers to enable for this profile (allowlist). */
  enabled?: string[];
  /** MCP servers to force-disable (denylist), mirrors omp `disabledServers`. */
  disabledServers?: string[];
}

export interface Profile {
  /** Unique identifier. */
  name: string;
  /** Human-readable description shown in the picker. */
  description?: string;
  /** role -> model spec string, e.g. { default: "anthropic/claude-opus-4-5:high" }. */
  modelRoles?: Partial<Record<Role, string>>;
  /** Per-key fallback chains (mirrors omp retry.fallbackChains). */
  fallbackChains?: Record<string, string[]>;
  /** MCP enable/disable sets. */
  mcp?: ProfileMcp;
  /** Active tool set (mirrors omp `--tools`). */
  tools?: string[];
  /** Enabled rules / prompt template references. */
  rules?: string[];
  /** Directories this profile auto-activates in (PRD §4.3 form 2). */
  boundPaths?: string[];
}

/** Allowed profile name shape — keeps it safe as a filename stem. */
export const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface ProfileValidation {
  /** The coerced profile (best-effort), or null when unrecoverable. */
  profile: Profile | null;
  /** Fatal structural problems. Non-empty => `profile` is unusable. */
  errors: string[];
  /** Non-fatal issues (ignored/dropped content). */
  warnings: string[];
}

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Coerce a value into a string[] of trimmed, non-empty entries. */
function coerceStringArray(
  value: unknown,
  field: string,
  warnings: string[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(`"${field}" should be a list; ignoring.`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      out.push(item.trim());
    } else {
      warnings.push(`"${field}" entries must be non-empty strings; skipped one.`);
    }
  }
  return out;
}

/**
 * Validate and coerce an arbitrary parsed object (e.g. from YAML) into a
 * Profile. `fallbackName` supplies the name when the document omits it (e.g.
 * derived from the filename).
 */
export function validateProfile(
  input: unknown,
  fallbackName?: string,
): ProfileValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(input)) {
    return {
      profile: null,
      errors: ["Profile must be a mapping/object."],
      warnings,
    };
  }

  // name
  let name: string | undefined;
  if (typeof input.name === "string" && input.name.trim().length > 0) {
    name = input.name.trim();
  } else if (fallbackName && fallbackName.trim().length > 0) {
    name = fallbackName.trim();
  }
  if (!name) {
    errors.push("Profile is missing a `name`.");
  } else if (!isValidProfileName(name)) {
    errors.push(
      `Invalid profile name "${name}": use letters, digits, ".", "_", "-" (max 64 chars).`,
    );
  }

  // description
  let description: string | undefined;
  if (input.description !== undefined) {
    if (typeof input.description === "string") {
      description = input.description;
    } else {
      warnings.push("`description` should be a string; ignoring.");
    }
  }

  // modelRoles
  let modelRoles: Partial<Record<Role, string>> | undefined;
  if (input.modelRoles !== undefined) {
    if (isPlainObject(input.modelRoles)) {
      const roles: Partial<Record<Role, string>> = {};
      for (const [key, val] of Object.entries(input.modelRoles)) {
        if (!isRole(key)) {
          warnings.push(`Unknown model role "${key}"; ignoring.`);
          continue;
        }
        if (typeof val === "string" && val.trim().length > 0) {
          roles[key] = val.trim();
        } else {
          warnings.push(`Model role "${key}" must map to a non-empty string; ignoring.`);
        }
      }
      if (Object.keys(roles).length > 0) modelRoles = roles;
    } else {
      warnings.push("`modelRoles` should be a mapping; ignoring.");
    }
  }

  // fallbackChains
  let fallbackChains: Record<string, string[]> | undefined;
  if (input.fallbackChains !== undefined) {
    if (isPlainObject(input.fallbackChains)) {
      const chains: Record<string, string[]> = {};
      for (const [key, val] of Object.entries(input.fallbackChains)) {
        const arr = coerceStringArray(val, `fallbackChains.${key}`, warnings);
        if (arr && arr.length > 0) chains[key] = arr;
      }
      if (Object.keys(chains).length > 0) fallbackChains = chains;
    } else {
      warnings.push("`fallbackChains` should be a mapping; ignoring.");
    }
  }

  // mcp
  let mcp: ProfileMcp | undefined;
  if (input.mcp !== undefined) {
    if (isPlainObject(input.mcp)) {
      const enabled = coerceStringArray(input.mcp.enabled, "mcp.enabled", warnings);
      const disabledServers = coerceStringArray(
        input.mcp.disabledServers,
        "mcp.disabledServers",
        warnings,
      );
      const next: ProfileMcp = {};
      if (enabled) next.enabled = enabled;
      if (disabledServers) next.disabledServers = disabledServers;
      if (Object.keys(next).length > 0) mcp = next;
    } else {
      warnings.push("`mcp` should be a mapping; ignoring.");
    }
  }

  // tools / rules / boundPaths
  const tools = coerceStringArray(input.tools, "tools", warnings);
  const rules = coerceStringArray(input.rules, "rules", warnings);
  const boundPaths = coerceStringArray(input.boundPaths, "boundPaths", warnings);

  if (errors.length > 0 || !name) {
    return { profile: null, errors, warnings };
  }

  const profile: Profile = { name };
  if (description !== undefined) profile.description = description;
  if (modelRoles) profile.modelRoles = modelRoles;
  if (fallbackChains) profile.fallbackChains = fallbackChains;
  if (mcp) profile.mcp = mcp;
  if (tools) profile.tools = tools;
  if (rules) profile.rules = rules;
  if (boundPaths) profile.boundPaths = boundPaths;

  return { profile, errors, warnings };
}
