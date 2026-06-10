/**
 * `/profile` slash command: the entire user-facing surface (pure /command form).
 *
 *   /profile                 open a picker and switch
 *   /profile <name>          switch to a named profile
 *   /profile list            list all profiles
 *   /profile show [name]     show a profile (current if omitted)
 *   /profile create <name> [flags]   create a profile (imperative)
 *   /profile delete <name>   delete a profile
 *   /profile help            usage
 *
 * Arg parsing and output formatting are pure and exported for unit testing;
 * side-effecting dispatch lives in `handleProfileCommand`.
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUISelectItem,
} from "@oh-my-pi/pi-coding-agent";
import { stringify as stringifyYaml } from "yaml";
import { applyProfile } from "./apply.js";
import { isReservedName } from "./builtin.js";
import { type Role } from "./roles.js";
import { validateProfile, type Profile } from "./schema.js";
import type { ProfileStore, StoredProfile } from "./store.js";

/** Mutable runtime state shared with the extension entrypoint. */
export interface ProfileEnv {
  store: ProfileStore;
  /** Name of the profile currently active in this session, if any. */
  current: string | undefined;
}

// ---------------------------------------------------------------------------
// Tokenizing & arg parsing (pure)
// ---------------------------------------------------------------------------

/** Split a command argument string into tokens, honoring single/double quotes. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ROLE_FLAGS: Record<string, Role> = {
  "--model": "default",
  "--default-model": "default",
  "--smol-model": "smol",
  "--slow-model": "slow",
  "--vision-model": "vision",
  "--plan-model": "plan",
  "--designer-model": "designer",
  "--commit-model": "commit",
  "--task-model": "task",
};

export interface CreateSpec {
  profile: Profile | null;
  scope: "user" | "project";
  errors: string[];
  warnings: string[];
}

/**
 * Parse `create` arguments (tokens after the `create` subcommand) into a
 * profile. The first non-flag token is the profile name.
 */
export function parseCreateArgs(tokens: string[]): CreateSpec {
  const errors: string[] = [];
  let name: string | undefined;
  const modelRoles: Partial<Record<Role, string>> = {};
  const raw: Record<string, unknown> = {};
  const boundPaths: string[] = [];
  let scope: "user" | "project" = "user";

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? "";
    if (!tok.startsWith("-")) {
      if (name === undefined) name = tok;
      else errors.push(`Unexpected argument "${tok}".`);
      continue;
    }

    let key = tok;
    let inlineVal: string | undefined;
    const eq = tok.indexOf("=");
    if (eq >= 0) {
      key = tok.slice(0, eq);
      inlineVal = tok.slice(eq + 1);
    }
    const consume = (): string | undefined => {
      if (inlineVal !== undefined) return inlineVal;
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith("--")) return undefined;
      i++;
      return next;
    };

    const role = ROLE_FLAGS[key];
    if (role) {
      const v = consume();
      if (v) modelRoles[role] = v;
      else errors.push(`${key} needs a value.`);
      continue;
    }

    switch (key) {
      case "--tools":
        raw.tools = splitCsv(consume());
        break;
      case "--rules":
        raw.rules = splitCsv(consume());
        break;
      case "--mcp": {
        const mcp = (raw.mcp as Record<string, unknown>) ?? {};
        mcp.enabled = splitCsv(consume());
        raw.mcp = mcp;
        break;
      }
      case "--disable-mcp": {
        const mcp = (raw.mcp as Record<string, unknown>) ?? {};
        mcp.disabledServers = splitCsv(consume());
        raw.mcp = mcp;
        break;
      }
      case "--bind-path": {
        const v = consume();
        if (v) boundPaths.push(v);
        else errors.push("--bind-path needs a value.");
        break;
      }
      case "--description": {
        const v = consume();
        if (v !== undefined) raw.description = v;
        break;
      }
      case "--scope": {
        const v = consume();
        if (v === "user" || v === "project") scope = v;
        else errors.push("--scope must be `user` or `project`.");
        break;
      }
      default:
        errors.push(`Unknown flag "${key}".`);
    }
  }

  if (Object.keys(modelRoles).length > 0) raw.modelRoles = modelRoles;
  if (boundPaths.length > 0) raw.boundPaths = boundPaths;
  if (name !== undefined) raw.name = name;

  if (errors.length > 0) {
    return { profile: null, scope, errors, warnings: [] };
  }

  const { profile, errors: vErrors, warnings } = validateProfile(raw);
  return { profile, scope, errors: vErrors, warnings };
}

// ---------------------------------------------------------------------------
// Formatting (pure)
// ---------------------------------------------------------------------------

const SCOPE_TAG: Record<StoredProfile["scope"], string> = {
  builtin: "built-in",
  user: "user",
  project: "project",
};

export function formatProfileList(
  profiles: readonly StoredProfile[],
  current: string | undefined,
): string {
  if (profiles.length === 0) return "No profiles found.";
  const lines = profiles.map((sp) => {
    const marker = sp.profile.name === current ? "●" : " ";
    const desc = sp.profile.description ? ` — ${sp.profile.description}` : "";
    return `${marker} ${sp.profile.name} [${SCOPE_TAG[sp.scope]}]${desc}`;
  });
  return ["Profiles (● = active):", ...lines].join("\n");
}

export function formatProfileShow(sp: StoredProfile, current: string | undefined): string {
  const header =
    `Profile: ${sp.profile.name} [${SCOPE_TAG[sp.scope]}]` +
    (sp.profile.name === current ? " (active)" : "");
  const body = stringifyYaml(sp.profile).trimEnd();
  const lines = [header, "", body];
  if (sp.warnings.length > 0) {
    lines.push("", "Warnings:", ...sp.warnings.map((w) => `  - ${w}`));
  }
  return lines.join("\n");
}

/** Build a one-line summary of an apply result for notify(). */
export function formatApplyResult(
  name: string,
  applied: string[],
  warnings: string[],
  unsupported: string[],
): { message: string; level: "info" | "warning" } {
  const parts = [`Switched to profile "${name}".`];
  if (applied.length > 0) parts.push(`Applied: ${applied.join(", ")}.`);
  if (unsupported.length > 0) {
    parts.push(`Not applied (no runtime API): ${unsupported.join(", ")}.`);
  }
  if (warnings.length > 0) parts.push(`Warnings: ${warnings.join(" ")}`);
  const level = warnings.length > 0 ? "warning" : "info";
  return { message: parts.join(" "), level };
}

const HELP = [
  "Usage:",
  "  /profile                 pick a profile and switch",
  "  /profile <name>          switch to a named profile",
  "  /profile list            list all profiles",
  "  /profile show [name]     show a profile (current if omitted)",
  "  /profile create <name> [flags]",
  "  /profile delete <name>   delete a profile",
  "  /profile help            show this help",
  "",
  "create flags:",
  "  --model / --default-model <spec>   primary model, e.g. anthropic/claude-opus-4-5:high",
  "  --plan-model / --smol-model / ...  per-role model",
  "  --tools a,b,c        active tool set",
  "  --mcp a,b            enable MCP servers     --disable-mcp a,b",
  "  --rules a,b          enabled rules",
  "  --bind-path <dir>    bind a directory (repeatable)",
  "  --description <text> --scope user|project",
].join("\n");

// ---------------------------------------------------------------------------
// Dispatch (side-effecting)
// ---------------------------------------------------------------------------

async function switchToProfile(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  env: ProfileEnv,
  name: string,
): Promise<void> {
  const sp = await env.store.get(name);
  if (!sp) {
    ctx.ui.notify(`Profile "${name}" not found.`, "error");
    return;
  }
  // Default: don't interrupt an in-flight turn — wait for idle before mutating.
  await ctx.waitForIdle();
  const { applied, warnings, unsupported } = await applyProfile(pi, ctx, sp.profile);
  env.current = sp.profile.name;
  const { message, level } = formatApplyResult(
    sp.profile.name,
    applied,
    warnings,
    unsupported,
  );
  ctx.ui.notify(message, level);
}

async function pickAndSwitch(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  env: ProfileEnv,
): Promise<void> {
  const profiles = await env.store.list();
  if (profiles.length === 0) {
    ctx.ui.notify("No profiles to switch to. Create one with /profile create.", "info");
    return;
  }
  const options: ExtensionUISelectItem[] = profiles.map((sp) => {
    const active = sp.profile.name === env.current ? "● active — " : "";
    return {
      label: sp.profile.name,
      description: active + (sp.profile.description ?? SCOPE_TAG[sp.scope]),
    };
  });
  const choice = await ctx.ui.select("Switch profile", options);
  if (!choice) return;
  await switchToProfile(pi, ctx, env, choice);
}

export async function handleProfileCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string,
  env: ProfileEnv,
): Promise<void> {
  const tokens = tokenize(args);
  const sub = tokens[0];

  if (sub === undefined) {
    await pickAndSwitch(pi, ctx, env);
    return;
  }

  switch (sub) {
    case "list": {
      const profiles = await env.store.list();
      ctx.ui.notify(formatProfileList(profiles, env.current), "info");
      return;
    }
    case "show": {
      const name = tokens[1] ?? env.current;
      if (!name) {
        ctx.ui.notify("No active profile. Usage: /profile show <name>.", "info");
        return;
      }
      const sp = await env.store.get(name);
      if (!sp) {
        ctx.ui.notify(`Profile "${name}" not found.`, "error");
        return;
      }
      ctx.ui.notify(formatProfileShow(sp, env.current), "info");
      return;
    }
    case "create": {
      const { profile, scope, errors, warnings } = parseCreateArgs(tokens.slice(1));
      if (!profile) {
        ctx.ui.notify(
          ["Could not create profile:", ...errors.map((e) => `  - ${e}`)].join("\n"),
          "error",
        );
        return;
      }
      if (await env.store.has(profile.name)) {
        const overwrite = await ctx.ui.confirm(
          "Overwrite?",
          `Profile "${profile.name}" already exists. Overwrite it?`,
        );
        if (!overwrite) {
          ctx.ui.notify("Create cancelled.", "info");
          return;
        }
      }
      try {
        const path = await env.store.save(profile, scope);
        const note = warnings.length > 0 ? ` (warnings: ${warnings.join(" ")})` : "";
        ctx.ui.notify(`Created profile "${profile.name}" at ${path}.${note}`, "info");
      } catch (err) {
        ctx.ui.notify(`Failed to save profile: ${(err as Error).message}`, "error");
      }
      return;
    }
    case "delete": {
      const name = tokens[1];
      if (!name) {
        ctx.ui.notify("Usage: /profile delete <name>.", "info");
        return;
      }
      if (isReservedName(name)) {
        ctx.ui.notify(`"${name}" is a built-in profile and cannot be deleted.`, "error");
        return;
      }
      if (!(await env.store.has(name))) {
        ctx.ui.notify(`Profile "${name}" not found.`, "error");
        return;
      }
      const ok = await ctx.ui.confirm("Delete?", `Delete profile "${name}"?`);
      if (!ok) {
        ctx.ui.notify("Delete cancelled.", "info");
        return;
      }
      const removed = await env.store.delete(name);
      ctx.ui.notify(
        removed ? `Deleted profile "${name}".` : `Nothing to delete for "${name}".`,
        "info",
      );
      if (env.current === name) env.current = undefined;
      return;
    }
    case "help": {
      ctx.ui.notify(HELP, "info");
      return;
    }
    default: {
      // Treat the first token as a profile name to switch to.
      await switchToProfile(pi, ctx, env, sub);
      return;
    }
  }
}
