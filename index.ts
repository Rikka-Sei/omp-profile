/**
 * omp-profile — VS Code Profile-style environment profiles for omp.
 *
 * Registers the `/profile` slash command and a session_start hook that:
 *   - captures the omp-default model + tool set (so `/profile reset` can restore it),
 *   - initializes the status-bar indicator,
 *   - auto-activates a directory-bound profile when one matches the cwd.
 *
 * Everything is exposed as in-session commands; no CLI flags, no external
 * services, and omp's own global config is never modified.
 */
import { homedir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import {
  handleProfileCommand,
  switchToProfile,
  updateStatus,
  type ProfileEnv,
} from "./src/commands.js";
import { matchBoundProfile } from "./src/resolve.js";
import { ProfileStore } from "./src/store.js";

export default function activate(pi: ExtensionAPI): void {
  pi.setLabel("Profiles");
  const home = homedir();

  const env: ProfileEnv = {
    store: new ProfileStore({ home, cwd: process.cwd() }),
    current: undefined,
  };

  pi.registerCommand("profile", {
    description: "Switch, create, list, show, reset, or delete environment profiles.",
    handler: async (args, ctx) => {
      env.store = new ProfileStore({ home, cwd: ctx.cwd });
      await handleProfileCommand(pi, ctx, args, env);
    },
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    // Capture omp defaults once, for /profile reset.
    if (!env.baseline) {
      try {
        env.baseline = { model: ctx.model, tools: pi.getActiveTools() };
      } catch {
        env.baseline = { model: ctx.model, tools: [] };
      }
    }

    // Show the status-bar indicator.
    updateStatus(ctx, env.current);

    // Directory-bound auto-activation (only when nothing is active yet, so an
    // explicit /profile switch always wins — precedence §4.6).
    if (env.current !== undefined) return;
    const store = new ProfileStore({ home, cwd: ctx.cwd });
    const profiles = (await store.list()).map((sp) => sp.profile);
    const match = matchBoundProfile(profiles, ctx.cwd, home);
    if (!match) return;
    env.store = store;
    await switchToProfile(pi, ctx, env, match.name);
  });
}
