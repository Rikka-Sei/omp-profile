import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../src/store.js";

let home: string;
let cwd: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "omp-home-"));
  cwd = await mkdtemp(join(tmpdir(), "omp-cwd-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("ProfileStore", () => {
  test("built-in empty profile is always present", async () => {
    const store = new ProfileStore({ home, cwd });
    const list = await store.list();
    const empty = list.find((s) => s.profile.name === "empty");
    expect(empty?.scope).toBe("builtin");
  });

  test("save then get (user scope)", async () => {
    const store = new ProfileStore({ home, cwd });
    const path = await store.save({ name: "work", tools: ["read"] });
    expect(path).toContain("profiles");
    const sp = await store.get("work");
    expect(sp?.profile.tools).toEqual(["read"]);
    expect(sp?.scope).toBe("user");
  });

  test("project scope overrides same-named user profile", async () => {
    const store = new ProfileStore({ home, cwd });
    await store.save({ name: "x", description: "user-one" }, "user");
    await store.save({ name: "x", description: "project-one" }, "project");
    const sp = await store.get("x");
    expect(sp?.scope).toBe("project");
    expect(sp?.profile.description).toBe("project-one");
  });

  test("delete removes a profile", async () => {
    const store = new ProfileStore({ home, cwd });
    await store.save({ name: "gone" });
    expect(await store.has("gone")).toBe(true);
    expect(await store.delete("gone")).toBe(true);
    expect(await store.has("gone")).toBe(false);
  });

  test("cannot save a reserved name", async () => {
    const store = new ProfileStore({ home, cwd });
    await expect(store.save({ name: "empty" })).rejects.toThrow();
  });

  test("cannot delete a reserved name", async () => {
    const store = new ProfileStore({ home, cwd });
    await expect(store.delete("empty")).rejects.toThrow();
  });

  test("invalid profile content surfaces as warnings", async () => {
    const dir = join(home, ".omp", "agent", "profiles");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "broken.json"), "{ not valid json");
    const store = new ProfileStore({ home, cwd });
    const sp = await store.get("broken");
    expect(sp?.warnings.length).toBeGreaterThan(0);
  });

  test("round-trips a rich profile through JSON", async () => {
    const store = new ProfileStore({ home, cwd });
    await store.save({
      name: "rich",
      description: "all fields",
      modelRoles: { default: "anthropic/claude-opus-4-5:high", plan: "openai/gpt-5.4" },
      tools: ["read", "edit"],
      mcp: { enabled: ["fs"], disabledServers: ["pg"] },
      rules: ["r1"],
      boundPaths: ["~/work"],
    });
    const sp = await store.get("rich");
    expect(sp?.profile.modelRoles?.default).toBe("anthropic/claude-opus-4-5:high");
    expect(sp?.profile.mcp?.disabledServers).toEqual(["pg"]);
    expect(sp?.profile.boundPaths).toEqual(["~/work"]);
  });
});
