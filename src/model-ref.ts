/**
 * Parsing of profile model specifiers like:
 *   "anthropic/claude-opus-4-5:high"   -> provider, modelId, thinking
 *   "claude-opus-4-6:high"             -> canonical (bare) id + thinking
 *   "openai/gpt-5.4"                   -> provider + modelId, no thinking
 *
 * Pure (no host dependency) so it can be unit-tested in isolation. Resolution
 * of a `ModelRef` into a real `Model` lives in `apply.ts` (needs ModelRegistry).
 */
import { isThinkingLevel, type ThinkingLevel } from "./roles.js";

export interface ModelRef {
  /** The original, untrimmed-significant spec string. */
  raw: string;
  /** Provider segment before the first "/", if present (e.g. "anthropic"). */
  provider?: string;
  /** Model id (canonical bare id when no provider). */
  modelId: string;
  /** Thinking selector parsed from a trailing ":<level>", if valid. */
  thinking?: ThinkingLevel;
}

/**
 * Parse a model spec. Returns `undefined` only when the string is blank or has
 * no usable model id. The thinking suffix is recognised only when the text
 * after the last ":" is a valid thinking level, so model ids containing other
 * colons are left intact.
 */
export function parseModelRef(spec: string): ModelRef | undefined {
  const raw = spec.trim();
  if (raw.length === 0) return undefined;

  let body = raw;
  let thinking: ThinkingLevel | undefined;

  const colon = body.lastIndexOf(":");
  if (colon >= 0) {
    const suffix = body.slice(colon + 1);
    if (isThinkingLevel(suffix)) {
      thinking = suffix;
      body = body.slice(0, colon);
    }
  }

  body = body.trim();
  if (body.length === 0) return undefined;

  let provider: string | undefined;
  let modelId = body;
  const slash = body.indexOf("/");
  if (slash >= 0) {
    provider = body.slice(0, slash).trim();
    modelId = body.slice(slash + 1).trim();
    if (provider.length === 0) provider = undefined;
  }

  if (modelId.length === 0) return undefined;

  return { raw, provider, modelId, thinking };
}

/** Render a ModelRef back to its canonical "provider/id:thinking" string form. */
export function formatModelRef(ref: ModelRef): string {
  const base = ref.provider ? `${ref.provider}/${ref.modelId}` : ref.modelId;
  return ref.thinking ? `${base}:${ref.thinking}` : base;
}
