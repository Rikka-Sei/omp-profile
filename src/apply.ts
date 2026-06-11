/**
 * Apply a resolved profile to the running session.
 *
 * What the real omp ExtensionAPI lets us hot-apply at runtime:
 *   - primary model        -> pi.setModel(Model)
 *   - thinking level       -> pi.setThinkingLevel(level)
 *   - active tool set      -> pi.setActiveTools(names)
 *
 * Per-role model overrides (other than `default`), MCP enable/disable sets,
 * rules, and fallback chains have no runtime API; they are recorded as
 * `unsupported` and surfaced to the user instead of being silently dropped.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  Model,
  ModelRegistry,
} from "@oh-my-pi/pi-coding-agent";
import { formatModelRef, parseModelRef, type ModelRef } from "./model-ref.js";
import type { Profile } from "./schema.js";

export interface ApplyResult {
  /** Active model id after applying — set only if the profile changed it. */
  modelId?: string;
  /** Thinking level applied — set only if the spec carried one. */
  thinking?: string;
  /** Active tool set after applying — set only if the profile specified tools. */
  tools?: string[];
  /** Recoverable problems (bad spec, unknown model/tool, no API key). */
  warnings: string[];
  /** Profile parts that have no runtime API and were not applied. */
  unsupported: string[];
}

/** Resolve a model ref to a real Model via the registry (provider-qualified first). */
export function resolveModel(
  registry: ModelRegistry,
  ref: ModelRef,
): Model | undefined {
  if (ref.provider) {
    const found = registry.find(ref.provider, ref.modelId);
    if (found) return found;
  }
  return registry.resolveCanonicalModel(ref.modelId);
}

export async function applyProfile(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  profile: Profile,
): Promise<ApplyResult> {
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const result: ApplyResult = { warnings, unsupported };

  // 1. Primary (default-role) model + thinking selector.
  const defaultSpec = profile.modelRoles?.default;
  if (defaultSpec) {
    const ref = parseModelRef(defaultSpec);
    if (!ref) {
      warnings.push(`Invalid default model spec "${defaultSpec}".`);
    } else {
      const model = resolveModel(ctx.modelRegistry, ref);
      if (!model) {
        warnings.push(`Default model "${formatModelRef(ref)}" not found.`);
      } else {
        const ok = await pi.setModel(model);
        if (!ok) {
          warnings.push(`No API key available for model "${model.id}".`);
        } else {
          result.modelId = model.id;
          if (ref.thinking) {
            pi.setThinkingLevel(ref.thinking);
            result.thinking = ref.thinking;
          }
        }
      }
    }
  }

  // 2. Active tool set (validated against the host's known tools).
  if (profile.tools) {
    const known = new Set(pi.getAllTools());
    const valid = profile.tools.filter((t) => known.has(t));
    const invalid = profile.tools.filter((t) => !known.has(t));
    if (invalid.length > 0) {
      warnings.push(`Unknown tools ignored: ${invalid.join(", ")}.`);
    }
    await pi.setActiveTools(valid);
    result.tools = valid;
  }

  // 3. Parts with no runtime API — recorded, not applied.
  const otherRoles = Object.keys(profile.modelRoles ?? {}).filter(
    (r) => r !== "default",
  );
  if (otherRoles.length > 0) {
    unsupported.push(`role models (${otherRoles.join(", ")})`);
  }
  const mcp = profile.mcp;
  if (mcp && ((mcp.enabled?.length ?? 0) > 0 || (mcp.disabledServers?.length ?? 0) > 0)) {
    unsupported.push("MCP enable/disable");
  }
  if ((profile.rules?.length ?? 0) > 0) {
    unsupported.push("rules");
  }
  if (profile.fallbackChains && Object.keys(profile.fallbackChains).length > 0) {
    unsupported.push("fallback chains");
  }

  return result;
}

/** The session's original (omp-default) state, captured at session start. */
export interface Baseline {
  model: Model | undefined;
  tools: string[];
}

/**
 * Restore the session to its omp defaults: the model and active tool set that
 * were in effect when the session started. Used by `/profile reset`.
 */
export async function applyReset(
  pi: ExtensionAPI,
  baseline: Baseline | undefined,
): Promise<{ modelId?: string; tools: string[] }> {
  const tools = baseline?.tools ?? pi.getAllTools();
  await pi.setActiveTools(tools);
  let modelId: string | undefined;
  if (baseline?.model) {
    const ok = await pi.setModel(baseline.model);
    if (ok) modelId = baseline.model.id;
  }
  return modelId ? { modelId, tools } : { tools };
}
