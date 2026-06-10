import { describe, expect, test } from "bun:test";
import { formatModelRef, parseModelRef } from "../src/model-ref.js";

describe("parseModelRef", () => {
  test("provider/id:thinking", () => {
    expect(parseModelRef("anthropic/claude-opus-4-5:high")).toEqual({
      raw: "anthropic/claude-opus-4-5:high",
      provider: "anthropic",
      modelId: "claude-opus-4-5",
      thinking: "high",
    });
  });

  test("bare canonical id + thinking", () => {
    const r = parseModelRef("claude-opus-4-6:minimal");
    expect(r?.provider).toBeUndefined();
    expect(r?.modelId).toBe("claude-opus-4-6");
    expect(r?.thinking).toBe("minimal");
  });

  test("provider/id without thinking", () => {
    const r = parseModelRef("openai/gpt-5.4");
    expect(r?.provider).toBe("openai");
    expect(r?.modelId).toBe("gpt-5.4");
    expect(r?.thinking).toBeUndefined();
  });

  test("trailing colon that is not a thinking level stays in id", () => {
    const r = parseModelRef("foo/bar:baz");
    expect(r?.provider).toBe("foo");
    expect(r?.modelId).toBe("bar:baz");
    expect(r?.thinking).toBeUndefined();
  });

  test("blank input is undefined", () => {
    expect(parseModelRef("   ")).toBeUndefined();
  });

  test("formatModelRef round-trips", () => {
    const r = parseModelRef("anthropic/claude-opus-4-5:high");
    expect(r && formatModelRef(r)).toBe("anthropic/claude-opus-4-5:high");
  });

  test("formatModelRef bare", () => {
    const r = parseModelRef("gpt-5.4");
    expect(r && formatModelRef(r)).toBe("gpt-5.4");
  });
});
