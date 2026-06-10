import { describe, expect, test } from "bun:test";
import { isValidProfileName, validateProfile } from "../src/schema.js";

describe("validateProfile", () => {
  test("minimal valid profile", () => {
    const { profile, errors } = validateProfile({ name: "work" });
    expect(errors).toEqual([]);
    expect(profile?.name).toBe("work");
  });

  test("uses fallbackName when name omitted", () => {
    const { profile } = validateProfile({}, "fromfile");
    expect(profile?.name).toBe("fromfile");
  });

  test("missing name is a fatal error", () => {
    const { profile, errors } = validateProfile({});
    expect(profile).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  test("invalid name is rejected", () => {
    expect(validateProfile({ name: "bad name!" }).profile).toBeNull();
  });

  test("unknown model role is dropped with a warning", () => {
    const { profile, warnings } = validateProfile({
      name: "x",
      modelRoles: { default: "a/b", bogus: "c" },
    });
    expect(profile?.modelRoles).toEqual({ default: "a/b" });
    expect(warnings.some((w) => w.includes("bogus"))).toBe(true);
  });

  test("tools coercion drops non-strings and empties", () => {
    const { profile, warnings } = validateProfile({
      name: "x",
      tools: ["read", 5, "edit", ""],
    });
    expect(profile?.tools).toEqual(["read", "edit"]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("mcp enabled/disabled lists", () => {
    const { profile } = validateProfile({
      name: "x",
      mcp: { enabled: ["fs"], disabledServers: ["pg"] },
    });
    expect(profile?.mcp).toEqual({ enabled: ["fs"], disabledServers: ["pg"] });
  });

  test("non-object input is a fatal error", () => {
    expect(validateProfile("nope").profile).toBeNull();
  });
});

describe("isValidProfileName", () => {
  test("accepts normal names", () => {
    expect(isValidProfileName("work-1.2_x")).toBe(true);
  });
  test("rejects spaces", () => {
    expect(isValidProfileName("1 2")).toBe(false);
  });
  test("rejects leading dot", () => {
    expect(isValidProfileName(".hidden")).toBe(false);
  });
});
