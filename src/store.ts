/**
 * Profile persistence: discovery, load, save, delete.
 *
 * Profiles live as single JSON files in two scopes, mirroring omp's own
 * config layering:
 *   - user:    ~/.omp/agent/profiles/<name>.json
 *   - project: <cwd>/.omp/profiles/<name>.json   (overrides same-named user)
 *
 * JSON (not YAML) so the plugin has zero third-party runtime dependencies:
 * omp loads extensions through its own module loader, where a bare npm
 * dependency like `yaml` may not resolve and would abort extension loading.
 *
 * The built-in `empty` profile is always present. We never read or write
 * omp's global config (~/.omp/agent/config.yml, models.yml, mcp.json) — the
 * "default profile" is omp's existing config and stays untouched (PRD §4.1).
 */
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyProfile, isReservedName } from "./builtin.js";
import { isValidProfileName, validateProfile, type Profile } from "./schema.js";

export type ProfileScope = "builtin" | "user" | "project";

export interface StoredProfile {
  profile: Profile;
  scope: ProfileScope;
  /** Absolute file path; undefined for built-ins. */
  path?: string;
  /** Non-fatal issues encountered while loading. */
  warnings: string[];
}

export interface ProfileStoreOptions {
  /** User home directory (for ~/.omp/agent/profiles). */
  home: string;
  /** Current working directory (for <cwd>/.omp/profiles). */
  cwd: string;
}

const PROFILE_EXT = ".json";

function stripExt(file: string): string | undefined {
  if (file.toLowerCase().endsWith(PROFILE_EXT)) {
    return file.slice(0, file.length - PROFILE_EXT.length);
  }
  return undefined;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export class ProfileStore {
  private readonly home: string;
  private readonly cwd: string;

  constructor(options: ProfileStoreOptions) {
    this.home = options.home;
    this.cwd = options.cwd;
  }

  userDir(): string {
    return join(this.home, ".omp", "agent", "profiles");
  }

  projectDir(): string {
    return join(this.cwd, ".omp", "profiles");
  }

  private dirForScope(scope: "user" | "project"): string {
    return scope === "project" ? this.projectDir() : this.userDir();
  }

  /** Load and validate every profile in a directory. */
  private async loadDir(
    dir: string,
    scope: "user" | "project",
  ): Promise<StoredProfile[]> {
    if (!(await dirExists(dir))) return [];
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const out: StoredProfile[] = [];
    for (const file of entries) {
      const stem = stripExt(file);
      if (stem === undefined) continue;
      const path = join(dir, file);
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        out.push({
          profile: { name: stem },
          scope,
          path,
          warnings: [`Failed to parse JSON: ${(err as Error).message}`],
        });
        continue;
      }
      const { profile, errors, warnings } = validateProfile(parsed, stem);
      if (!profile) {
        out.push({
          profile: { name: stem },
          scope,
          path,
          warnings: [...errors, ...warnings],
        });
        continue;
      }
      out.push({ profile, scope, path, warnings });
    }
    return out;
  }

  /**
   * All known profiles, de-duplicated by name with precedence
   * project > user > builtin. Returned sorted by name.
   */
  async list(): Promise<StoredProfile[]> {
    const byName = new Map<string, StoredProfile>();

    // builtin (lowest precedence)
    byName.set(emptyProfile().name, {
      profile: emptyProfile(),
      scope: "builtin",
      warnings: [],
    });

    for (const sp of await this.loadDir(this.userDir(), "user")) {
      byName.set(sp.profile.name, sp);
    }
    for (const sp of await this.loadDir(this.projectDir(), "project")) {
      byName.set(sp.profile.name, sp);
    }

    return [...byName.values()].sort((a, b) =>
      a.profile.name.localeCompare(b.profile.name),
    );
  }

  /** Get a single profile by name (respects precedence). */
  async get(name: string): Promise<StoredProfile | undefined> {
    return (await this.list()).find((sp) => sp.profile.name === name);
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== undefined;
  }

  /**
   * Save a profile as JSON. Defaults to the user scope. Refuses reserved
   * (built-in) names and invalid names. Returns the written file path.
   */
  async save(
    profile: Profile,
    scope: "user" | "project" = "user",
  ): Promise<string> {
    if (!isValidProfileName(profile.name)) {
      throw new Error(`Invalid profile name: "${profile.name}".`);
    }
    if (isReservedName(profile.name)) {
      throw new Error(`"${profile.name}" is a reserved built-in profile name.`);
    }
    const dir = this.dirForScope(scope);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${profile.name}${PROFILE_EXT}`);
    await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    return path;
  }

  /**
   * Delete a profile's file. Returns true if anything was removed. Built-in
   * profiles cannot be deleted.
   */
  async delete(name: string): Promise<boolean> {
    if (isReservedName(name)) {
      throw new Error(`"${name}" is a reserved built-in profile and cannot be deleted.`);
    }
    let removed = false;
    for (const scope of ["project", "user"] as const) {
      const path = join(this.dirForScope(scope), `${name}${PROFILE_EXT}`);
      try {
        await unlink(path);
        removed = true;
      } catch {
        // not present in this scope; ignore
      }
    }
    return removed;
  }
}
