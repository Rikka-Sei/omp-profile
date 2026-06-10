/**
 * Apply a resolved profile to the running session.
 *
 * What the real omp ExtensionAPI lets us hot-apply at runtime:
 *   - primary model        -> pi.setModel(Model)
 *   - thinking level       -> pi.setThinkingLevel(level)
 *   - active tool set      -> pi.setActiveTools(names)
 *
 * What it does NOT expose a runtime API for (recorded and surfaced to the user
 * instead of silently dropped): per-role model overrides other than `default`,
 * MCP enable/disable sets, rules, and fallback chains. These stay in the
 * profile file and fall back to omp's own config/default behaviour (PRD §4.6).
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
  /** Settings that were actually changed on the session. */
  applied: string[];
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
  const applied: string[] = [];
  const warnings: string[] = [];
  const unsupported: string[] = [];

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
          applied.push(`model=${model.id}`);
          if (ref.thinking) {
            pi.setThinkingLevel(ref.thinking);
            applied.push(`thinking=${ref.thinking}`);
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
    applied.push(`tools=[${valid.join(", ")}]`);
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

  return { applied, warnings, unsupported };
}
