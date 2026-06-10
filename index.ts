/**
 * omp-profile — VS Code Profile-style environment profiles for omp.
 *
 * Entry point: registers the `/profile` slash command and a session_start hook
 * for directory-bound auto-activation. Everything is exposed as in-session
 * commands; no CLI flags, no external services, and omp's own global config is
 * never modified.
 */
import { homedir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { applyProfile } from "./src/apply.js";
import {
  formatApplyResult,
  handleProfileCommand,
  type ProfileEnv,
} from "./src/commands.js";
import { matchBoundProfile } from "./src/resolve.js";
import { ProfileStore } from "./src/store.js";

export default function activate(pi: ExtensionAPI): void {
  pi.setLabel("Profiles");
  const home = homedir();

  // Session-scoped runtime state. `store` is rebuilt per invocation against the
  // session's cwd so project-level profiles resolve correctly; `current`
  // persists across commands within the session.
  const env: ProfileEnv = {
    store: new ProfileStore({ home, cwd: process.cwd() }),
    current: undefined,
  };

  pi.registerCommand("profile", {
    description: "Switch, list, create, show, or delete environment profiles.",
    handler: async (args, ctx) => {
      env.store = new ProfileStore({ home, cwd: ctx.cwd });
      await handleProfileCommand(pi, ctx, args, env);
    },
  });

  // Directory-bound auto-activation (PRD §4.3 form 2). Only activates when no
  // profile has been selected yet this session, so an explicit /profile switch
  // always wins (precedence §4.6).
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    if (env.current !== undefined) return;
    const store = new ProfileStore({ home, cwd: ctx.cwd });
    const profiles = (await store.list()).map((sp) => sp.profile);
    const match = matchBoundProfile(profiles, ctx.cwd, home);
    if (!match) return;
    const sp = await store.get(match.name);
    if (!sp) return;

    const { applied, warnings, unsupported } = await applyProfile(pi, ctx, sp.profile);
    env.store = store;
    env.current = sp.profile.name;

    if (ctx.hasUI) {
      const { message, level } = formatApplyResult(
        sp.profile.name,
        applied,
        warnings,
        unsupported,
      );
      ctx.ui.notify(`[auto, bound to ${match.boundPath}] ${message}`, level);
    }
  });
}
