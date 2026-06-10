import { describe, expect, test } from "bun:test";
import { isWithin, matchBoundProfile, normalizeDir } from "../src/resolve.js";
import type { Profile } from "../src/schema.js";

describe("normalizeDir", () => {
  test("expands ~/", () => {
    expect(normalizeDir("~/work", "/home/u")).toBe("/home/u/work");
  });
  test("expands bare ~", () => {
    expect(normalizeDir("~", "/home/u")).toBe("/home/u");
  });
  test("resolves relative segments in absolute paths", () => {
    expect(normalizeDir("/a/b/../c", "/home/u")).toBe("/a/c");
  });
});

describe("isWithin", () => {
  test("path is within itself", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
  });
  test("nested path matches", () => {
    expect(isWithin("/a/b/c", "/a/b")).toBe(true);
  });
  test("sibling prefix does not match", () => {
    expect(isWithin("/a/bc", "/a/b")).toBe(false);
  });
});

describe("matchBoundProfile", () => {
  const profiles: Profile[] = [
    { name: "root", boundPaths: ["~/work"] },
    { name: "deep", boundPaths: ["~/work/projectA"] },
  ];

  test("longest (most specific) bound path wins", () => {
    const m = matchBoundProfile(profiles, "/home/u/work/projectA/src", "/home/u");
    expect(m?.name).toBe("deep");
  });

  test("falls back to the broader binding", () => {
    const m = matchBoundProfile(profiles, "/home/u/work/other", "/home/u");
    expect(m?.name).toBe("root");
  });

  test("returns undefined when nothing matches", () => {
    expect(matchBoundProfile(profiles, "/tmp/x", "/home/u")).toBeUndefined();
  });
});
