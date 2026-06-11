import { describe, expect, test } from "bun:test";
import {
  computeToolDiff,
  formatProfileList,
  formatSwitchSummary,
  formatToolDiff,
  parseCreateArgs,
  shouldConfirmSwitch,
  statusText,
  summarizeProfile,
  tokenize,
} from "../src/commands.js";
import type { StoredProfile } from "../src/store.js";

describe("tokenize", () => {
  test("honors double quotes", () => {
    expect(
      tokenize(`create work --description "hello world" --tools a,b`),
    ).toEqual(["create", "work", "--description", "hello world", "--tools", "a,b"]);
  });
  test("blank string yields no tokens", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("parseCreateArgs", () => {
  test("parses a full create command", () => {
    const { profile, scope, errors } = parseCreateArgs(
      tokenize(
        `work --model anthropic/claude-opus-4-5:high --plan-model openai/gpt-5.4 ` +
          `--tools read,edit,bash --mcp fs,pg --disable-mcp legacy ` +
          `--bind-path ~/work --description "Work env" --scope project`,
      ),
    );
    expect(errors).toEqual([]);
    expect(scope).toBe("project");
    expect(profile?.name).toBe("work");
    expect(profile?.modelRoles).toEqual({
      default: "anthropic/claude-opus-4-5:high",
      plan: "openai/gpt-5.4",
    });
    expect(profile?.tools).toEqual(["read", "edit", "bash"]);
    expect(profile?.mcp).toEqual({ enabled: ["fs", "pg"], disabledServers: ["legacy"] });
    expect(profile?.boundPaths).toEqual(["~/work"]);
    expect(profile?.description).toBe("Work env");
  });

  test("supports --flag=value form", () => {
    const { profile } = parseCreateArgs(tokenize(`x --model=anthropic/foo`));
    expect(profile?.modelRoles?.default).toBe("anthropic/foo");
  });

  test("missing name is an error", () => {
    const { profile, errors } = parseCreateArgs(tokenize(`--tools read`));
    expect(profile).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  test("unknown flag is reported", () => {
    const { errors } = parseCreateArgs(tokenize(`x --bogus y`));
    expect(errors.some((e) => e.includes("bogus"))).toBe(true);
  });

  test("flag missing its value is an error", () => {
    const { profile, errors } = parseCreateArgs(tokenize(`x --model`));
    expect(profile).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("computeToolDiff", () => {
  test("reports added and removed", () => {
    expect(computeToolDiff(["a", "b", "c"], ["b", "c", "d"])).toEqual({
      added: ["d"],
      removed: ["a"],
    });
  });
  test("formatToolDiff renders both sides", () => {
    expect(formatToolDiff({ added: ["x"], removed: ["y"] })).toBe("工具 +x -y");
    expect(formatToolDiff({ added: [], removed: [] })).toBe("");
  });
});

describe("shouldConfirmSwitch", () => {
  test("true when 3+ tools are removed", () => {
    expect(shouldConfirmSwitch(["a", "b", "c", "d"], ["a"])).toBe(true);
  });
  test("false when fewer than 3 removed", () => {
    expect(shouldConfirmSwitch(["a", "b"], ["a"])).toBe(false);
  });
});

describe("summarizeProfile", () => {
  test("includes model and tool count", () => {
    const s = summarizeProfile({
      name: "x",
      modelRoles: { default: "a/b:high" },
      tools: ["r", "e"],
    });
    expect(s).toContain("a/b:high");
    expect(s).toContain("2 工具");
  });
  test("falls back to description", () => {
    expect(summarizeProfile({ name: "x", description: "hi" })).toBe("hi");
  });
  test("empty profile shows inherit hint", () => {
    expect(summarizeProfile({ name: "x" })).toBe("（继承默认）");
  });
});

describe("formatSwitchSummary", () => {
  test("model change, tool diff, and warning level", () => {
    const r = formatSwitchSummary(
      "dev",
      { from: "old", to: "new" },
      "high",
      { added: ["a"], removed: ["b"] },
      ["MCP enable/disable"],
      ["heads up"],
    );
    expect(r.level).toBe("warning");
    expect(r.message).toContain("dev");
    expect(r.message).toContain("old → new");
    expect(r.message).toContain("未即时生效");
  });
  test("clean switch is info level", () => {
    const r = formatSwitchSummary("x", undefined, undefined, { added: [], removed: [] }, [], []);
    expect(r.level).toBe("info");
  });
});

describe("statusText", () => {
  test("shows the active profile", () => {
    expect(statusText("dev")).toContain("dev");
  });
  test("shows default when none active", () => {
    expect(statusText(undefined)).toContain("default");
  });
});

describe("formatProfileList", () => {
  test("marks the active profile and shows scope", () => {
    const profiles: StoredProfile[] = [
      { profile: { name: "a" }, scope: "user", warnings: [] },
      { profile: { name: "b", description: "d" }, scope: "builtin", warnings: [] },
    ];
    const out = formatProfileList(profiles, "b");
    expect(out).toContain("● b");
    expect(out).toContain("a [user]");
    expect(out).toContain("b [built-in]");
  });
  test("handles empty list", () => {
    expect(formatProfileList([], undefined)).toBe("No profiles found.");
  });
});
