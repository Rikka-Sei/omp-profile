import { describe, expect, test } from "bun:test";
import { applyProfile, resolveModel } from "../src/apply.js";

interface FakeModel {
  id: string;
  provider: string;
}

function makeRegistry(models: FakeModel[]): any {
  return {
    find: (p: string, id: string) =>
      models.find((m) => m.provider === p && m.id === id),
    resolveCanonicalModel: (id: string) => models.find((m) => m.id === id),
    getAll: () => models,
    getAvailable: () => models,
    getCanonicalId: () => undefined,
  };
}

function makePi(opts: { hasKey?: boolean; allTools?: string[] }) {
  const calls: { model?: FakeModel; thinking?: string; tools?: string[] } = {};
  const pi: any = {
    getAllTools: () => opts.allTools ?? ["read", "edit", "bash", "task", "web_search"],
    getActiveTools: () => [],
    setActiveTools: async (t: string[]) => {
      calls.tools = t;
    },
    setModel: async (m: FakeModel) => {
      calls.model = m;
      return opts.hasKey ?? true;
    },
    getThinkingLevel: () => undefined,
    setThinkingLevel: (l: string) => {
      calls.thinking = l;
    },
  };
  return { pi, calls };
}

describe("applyProfile", () => {
  test("applies primary model + thinking + tool set, records unsupported parts", async () => {
    const ctx: any = { modelRegistry: makeRegistry([{ id: "claude-opus-4-5", provider: "anthropic" }]) };
    const { pi, calls } = makePi({ hasKey: true });
    const res = await applyProfile(pi, ctx, {
      name: "x",
      modelRoles: { default: "anthropic/claude-opus-4-5:high", plan: "openai/foo" },
      tools: ["read", "edit", "nope"],
      mcp: { enabled: ["fs"] },
      rules: ["r1"],
      fallbackChains: { "anthropic/claude-opus-4-5": ["openai/foo"] },
    });

    expect(calls.model?.id).toBe("claude-opus-4-5");
    expect(calls.thinking).toBe("high");
    expect(calls.tools).toEqual(["read", "edit"]); // unknown "nope" filtered out
    expect(res.warnings.some((w) => w.includes("nope"))).toBe(true);
    expect(res.unsupported).toContain("role models (plan)");
    expect(res.unsupported).toContain("MCP enable/disable");
    expect(res.unsupported).toContain("rules");
    expect(res.unsupported).toContain("fallback chains");
    expect(res.applied.some((a) => a.startsWith("model="))).toBe(true);
    expect(res.applied).toContain("thinking=high");
  });

  test("warns when the model cannot be resolved", async () => {
    const ctx: any = { modelRegistry: makeRegistry([]) };
    const { pi } = makePi({});
    const res = await applyProfile(pi, ctx, { name: "x", modelRoles: { default: "a/b" } });
    expect(res.warnings.some((w) => w.includes("not found"))).toBe(true);
  });

  test("warns when there is no API key for the model", async () => {
    const ctx: any = { modelRegistry: makeRegistry([{ id: "m", provider: "p" }]) };
    const { pi } = makePi({ hasKey: false });
    const res = await applyProfile(pi, ctx, { name: "x", modelRoles: { default: "p/m" } });
    expect(res.warnings.some((w) => w.includes("API key"))).toBe(true);
  });

  test("empty tool set is applied verbatim", async () => {
    const ctx: any = { modelRegistry: makeRegistry([]) };
    const { pi, calls } = makePi({});
    await applyProfile(pi, ctx, { name: "empty", tools: [] });
    expect(calls.tools).toEqual([]);
  });
});

describe("resolveModel", () => {
  test("prefers the provider-qualified match", () => {
    const reg = makeRegistry([
      { id: "m", provider: "p" },
      { id: "m", provider: "q" },
    ]);
    const r = resolveModel(reg, { raw: "p/m", provider: "p", modelId: "m" });
    expect(r?.provider).toBe("p");
  });

  test("falls back to canonical resolution when no provider", () => {
    const reg = makeRegistry([{ id: "solo", provider: "z" }]);
    const r = resolveModel(reg, { raw: "solo", modelId: "solo" });
    expect(r?.id).toBe("solo");
  });
});
