/**
 * `/profile` slash command — the entire user-facing surface.
 *
 *   /profile                 open a picker (switch / create / reset)
 *   /profile <name>          switch to a named profile
 *   /profile list            list all profiles
 *   /profile show [name]     show a profile (current if omitted)
 *   /profile create          interactive wizard
 *   /profile create <name> [flags]   imperative create
 *   /profile reset           restore omp defaults (exit current profile)
 *   /profile delete <name>   delete a profile
 *   /profile help            usage
 *
 * Arg parsing, diffing and formatting are pure and exported for unit testing;
 * side-effecting flows live in the handler functions.
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUISelectItem,
} from "@oh-my-pi/pi-coding-agent";
import { applyProfile, applyReset, type Baseline } from "./apply.js";
import { isReservedName } from "./builtin.js";
import { type Role } from "./roles.js";
import { isValidProfileName, validateProfile, type Profile } from "./schema.js";
import type { ProfileStore, StoredProfile } from "./store.js";

/** Mutable runtime state shared with the extension entrypoint. */
export interface ProfileEnv {
  store: ProfileStore;
  /** Name of the profile currently active in this session, if any. */
  current: string | undefined;
  /** omp-default model + tools captured at session start, for `reset`. */
  baseline?: Baseline;
}

const STATUS_KEY = "omp-profile";

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

export function statusText(current: string | undefined): string {
  return current ? `▣ ${current}` : "▣ default";
}

/** Update the persistent status-bar entry showing the active profile. */
export function updateStatus(ctx: ExtensionContext, current: string | undefined): void {
  if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, statusText(current));
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

export function splitCsv(value: string | undefined): string[] {
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

/** Parse `create` arguments (tokens after `create`) into a profile. */
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
// Diffing & formatting (pure)
// ---------------------------------------------------------------------------

export interface ToolDiff {
  added: string[];
  removed: string[];
}

export function computeToolDiff(before: string[], after: string[]): ToolDiff {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((t) => !b.has(t)),
    removed: before.filter((t) => !a.has(t)),
  };
}

/** Confirm before a switch that would disable a meaningful number of tools. */
export function shouldConfirmSwitch(before: string[], after: string[]): boolean {
  return computeToolDiff(before, after).removed.length >= 3;
}

export function formatToolDiff(diff: ToolDiff): string {
  const parts: string[] = [];
  if (diff.added.length > 0) parts.push(`+${diff.added.join(",")}`);
  if (diff.removed.length > 0) parts.push(`-${diff.removed.join(",")}`);
  return parts.length > 0 ? `工具 ${parts.join(" ")}` : "";
}

/** One-line summary of a profile's contents, for the picker. */
export function summarizeProfile(p: Profile): string {
  const parts: string[] = [];
  if (p.modelRoles?.default) parts.push(p.modelRoles.default);
  if (p.tools) parts.push(`${p.tools.length} 工具`);
  if (p.mcp?.enabled?.length) parts.push(`MCP ${p.mcp.enabled.length}`);
  const s = parts.join(" · ");
  if (s && p.description) return `${s} — ${p.description}`;
  return s || p.description || "（继承默认）";
}

export interface ModelChange {
  from: string | undefined;
  to: string;
}

export function formatSwitchSummary(
  name: string,
  modelChange: ModelChange | undefined,
  thinking: string | undefined,
  toolDiff: ToolDiff | undefined,
  unsupported: string[],
  warnings: string[],
): { message: string; level: "info" | "warning" } {
  const parts = [`已切换到 "${name}".`];
  if (modelChange) {
    parts.push(`模型 ${modelChange.from ?? "默认"} → ${modelChange.to}${thinking ? ` (${thinking})` : ""}.`);
  } else if (thinking) {
    parts.push(`思考档位 ${thinking}.`);
  }
  if (toolDiff) {
    const td = formatToolDiff(toolDiff);
    if (td) parts.push(`${td}.`);
  }
  if (unsupported.length > 0) {
    parts.push(`未即时生效: ${unsupported.join(", ")}.`);
  }
  if (warnings.length > 0) parts.push(`注意: ${warnings.join(" ")}`);
  return {
    message: parts.join(" "),
    level: warnings.length > 0 ? "warning" : "info",
  };
}

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
    return `${marker} ${sp.profile.name} [${SCOPE_TAG[sp.scope]}]  ${summarizeProfile(sp.profile)}`;
  });
  return ["Profiles (● = active):", ...lines].join("\n");
}

export function formatProfileShow(sp: StoredProfile, current: string | undefined): string {
  const header =
    `Profile: ${sp.profile.name} [${SCOPE_TAG[sp.scope]}]` +
    (sp.profile.name === current ? " (active)" : "");
  const body = JSON.stringify(sp.profile, null, 2);
  const lines = [header, "", body];
  if (sp.warnings.length > 0) {
    lines.push("", "Warnings:", ...sp.warnings.map((w) => `  - ${w}`));
  }
  return lines.join("\n");
}

const HELP = [
  "Usage:",
  "  /profile                 pick: switch / create / reset",
  "  /profile <name>          switch to a named profile",
  "  /profile list            list all profiles",
  "  /profile show [name]     show a profile (current if omitted)",
  "  /profile create          interactive wizard",
  "  /profile create <name> [flags]   imperative create",
  "  /profile reset           restore omp defaults (exit current profile)",
  "  /profile delete <name>   delete a profile",
  "  /profile help            show this help",
  "",
  "create flags: --model <spec>  --plan-model/--smol-model/...  --tools a,b",
  "              --mcp a,b  --disable-mcp a,b  --rules a,b  --bind-path <dir>",
  "              --description <text>  --scope user|project",
].join("\n");

// ---------------------------------------------------------------------------
// Switching (side-effecting)
// ---------------------------------------------------------------------------

/**
 * Apply a named profile to the session, reporting the concrete model/tool
 * changes. `opts.confirm` enables the "this disables N tools" guard (used for
 * interactive switches, not directory auto-activation).
 */
export async function switchToProfile(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  env: ProfileEnv,
  name: string,
  opts: { confirm?: boolean } = {},
): Promise<boolean> {
  const sp = await env.store.get(name);
  if (!sp) {
    ctx.ui.notify(`Profile "${name}" not found.`, "error");
    return false;
  }

  const beforeTools = pi.getActiveTools();
  const beforeModel = ctx.model?.id;

  // Preview the resulting tool set to decide whether to confirm.
  if (opts.confirm && ctx.hasUI && sp.profile.tools) {
    const known = new Set(pi.getAllTools());
    const afterPreview = sp.profile.tools.filter((t) => known.has(t));
    if (shouldConfirmSwitch(beforeTools, afterPreview)) {
      const removed = computeToolDiff(beforeTools, afterPreview).removed;
      const ok = await ctx.ui.confirm(
        "确认切换",
        `切到 "${name}" 会禁用 ${removed.length} 个当前工具（${removed.join(", ")}）。继续？`,
      );
      if (!ok) {
        ctx.ui.notify("已取消切换。", "info");
        return false;
      }
    }
  }

  const result = await applyProfile(pi, ctx, sp.profile);
  const afterTools = result.tools ?? beforeTools;

  env.current = sp.profile.name;
  updateStatus(ctx, env.current);

  const modelChange =
    result.modelId && result.modelId !== beforeModel
      ? { from: beforeModel, to: result.modelId }
      : undefined;
  const toolDiff = computeToolDiff(beforeTools, afterTools);
  const { message, level } = formatSwitchSummary(
    sp.profile.name,
    modelChange,
    result.thinking,
    toolDiff,
    result.unsupported,
    result.warnings,
  );
  ctx.ui.notify(message, level);
  return true;
}

/** Restore omp defaults: original model + tools, clear the active profile. */
async function resetToDefault(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  env: ProfileEnv,
): Promise<void> {
  const beforeTools = pi.getActiveTools();
  const r = await applyReset(pi, env.baseline);
  env.current = undefined;
  updateStatus(ctx, undefined);
  const toolDiff = computeToolDiff(beforeTools, r.tools);
  const td = formatToolDiff(toolDiff);
  ctx.ui.notify(`已恢复 omp 默认。${td ? `${td}.` : "（无变化）"}`, "info");
}

// ---------------------------------------------------------------------------
// Picker & wizard (side-effecting)
// ---------------------------------------------------------------------------

const ACTION_CREATE = "＋ 新建 profile";
const ACTION_RESET = "↩ 恢复 omp 默认";

async function pickAndAct(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  env: ProfileEnv,
): Promise<void> {
  const profiles = await env.store.list();
  const options: ExtensionUISelectItem[] = profiles.map((sp) => {
    const active = sp.profile.name === env.current ? "● " : "";
    return { label: sp.profile.name, description: active + summarizeProfile(sp.profile) };
  });
  options.push(
    { label: ACTION_CREATE, description: "用向导创建一个新 profile" },
    { label: ACTION_RESET, description: "退出当前 profile，恢复 omp 默认模型/工具" },
  );

  const choice = await ctx.ui.select("Profiles", options);
  if (!choice) return;
  if (choice === ACTION_CREATE) {
    await runWizard(pi, ctx, env);
    return;
  }
  if (choice === ACTION_RESET) {
    await resetToDefault(pi, ctx, env);
    return;
  }
  await switchToProfile(pi, ctx, env, choice, { confirm: true });
}

const THINKING_CHOICES = ["(默认)", "off", "minimal", "low", "medium", "high", "xhigh"];

/** Interactive create flow using basic UI primitives. */
async function runWizard(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  env: ProfileEnv,
): Promise<void> {
  // 1. Name
  const name = (await ctx.ui.input("Profile 名称", "例如 dev"))?.trim();
  if (!name) {
    ctx.ui.notify("已取消。", "info");
    return;
  }
  if (!isValidProfileName(name)) {
    ctx.ui.notify(`名称 "${name}" 不合法：仅限字母数字和 . _ -。`, "error");
    return;
  }
  if (await env.store.has(name)) {
    const overwrite = await ctx.ui.confirm("已存在", `Profile "${name}" 已存在，覆盖？`);
    if (!overwrite) {
      ctx.ui.notify("已取消。", "info");
      return;
    }
  }

  // 2. Description
  const description = (await ctx.ui.input("描述（可选，回车跳过）", ""))?.trim();

  // 3. Model + thinking
  const models = ctx.modelRegistry.getAvailable();
  const modelOptions: ExtensionUISelectItem[] = [
    { label: "(继承当前模型)", description: "不在 profile 里指定模型" },
    ...models.map((m) => ({
      label: m.provider ? `${m.provider}/${m.id}` : m.id,
      description: m.name ?? "",
    })),
  ];
  const modelChoice = await ctx.ui.select("主模型", modelOptions);
  let defaultModel: string | undefined;
  if (modelChoice && modelChoice !== "(继承当前模型)") {
    const lv = await ctx.ui.select(
      "思考档位",
      THINKING_CHOICES.map((l) => ({ label: l })),
    );
    defaultModel = lv && lv !== "(默认)" ? `${modelChoice}:${lv}` : modelChoice;
  }

  // 4. Tools
  const current = pi.getActiveTools();
  const toolChoice = await ctx.ui.select("工具集", [
    { label: "继承当前（不限定）", description: "profile 不限定工具" },
    { label: "沿用当前激活工具", description: current.join(", ") || "(无)" },
    { label: "自定义", description: "手动输入工具名" },
  ]);
  let tools: string[] | undefined;
  if (toolChoice === "沿用当前激活工具") {
    tools = current;
  } else if (toolChoice === "自定义") {
    const inp = await ctx.ui.input("工具（逗号分隔）", "read,edit,bash,task");
    tools = splitCsv(inp ?? "");
  }

  // Build + validate
  const raw: Record<string, unknown> = { name };
  if (description) raw.description = description;
  if (defaultModel) raw.modelRoles = { default: defaultModel };
  if (tools && tools.length > 0) raw.tools = tools;
  const { profile, errors } = validateProfile(raw);
  if (!profile) {
    ctx.ui.notify(["无法创建：", ...errors.map((e) => `  - ${e}`)].join("\n"), "error");
    return;
  }

  // 5. Confirm + save
  const ok = await ctx.ui.confirm("保存？", `创建 "${name}"：${summarizeProfile(profile)}`);
  if (!ok) {
    ctx.ui.notify("已取消。", "info");
    return;
  }
  try {
    await env.store.save(profile);
  } catch (err) {
    ctx.ui.notify(`保存失败：${(err as Error).message}`, "error");
    return;
  }
  ctx.ui.notify(`已创建 "${name}"。`, "info");

  // 6. Switch now?
  const switchNow = await ctx.ui.confirm("立即切换？", `现在切到 "${name}"？`);
  if (switchNow) await switchToProfile(pi, ctx, env, name);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function handleProfileCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string,
  env: ProfileEnv,
): Promise<void> {
  // Don't mutate a turn in flight (default: wait, not interrupt).
  await ctx.waitForIdle();

  const tokens = tokenize(args);
  const sub = tokens[0];

  if (sub === undefined) {
    await pickAndAct(pi, ctx, env);
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
    case "wizard": {
      await runWizard(pi, ctx, env);
      return;
    }
    case "create": {
      if (tokens.length === 1) {
        await runWizard(pi, ctx, env);
        return;
      }
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
    case "reset": {
      await resetToDefault(pi, ctx, env);
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
      if (env.current === name) {
        env.current = undefined;
        updateStatus(ctx, undefined);
      }
      return;
    }
    case "help": {
      ctx.ui.notify(HELP, "info");
      return;
    }
    default: {
      await switchToProfile(pi, ctx, env, sub, { confirm: true });
      return;
    }
  }
}
