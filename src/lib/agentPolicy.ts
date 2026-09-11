// The renderer's cache of the current agent's loop policy.
//
// The agent declares its cadence (electron/agents/*.ts → Agent.loop); the
// renderer executes it. This module is the seam between the two: one async
// fetch at session start, then a synchronous read on every tick.
//
// Deliberately NOT a per-mode table with default values baked in. Duplicating
// the numbers here is how they drift out of sync with the agent that owns
// them — the whole point of moving the policy onto the agent is that there is
// exactly one place to change it.

import { api } from "./api";
import type { AgentDescriptor, AppMode, LoopPolicy } from "./api";

// Single slot: one session runs at a time, and mode is fixed for its duration.
let cached: { mode: AppMode; descriptor: AgentDescriptor } | null = null;
// Keyed by mode so a describe still in flight for the previous mode can never
// resolve into the new mode's policy.
let inFlight: { mode: AppMode; promise: Promise<AgentDescriptor | null> } | null =
  null;

/**
 * Fetch and cache the policy for `mode`, or return the cached one. Returns
 * null if the agent could not be described — the caller should skip this tick
 * and try again rather than guessing at a cadence.
 */
export async function ensureAgentPolicy(
  mode: AppMode,
): Promise<LoopPolicy | null> {
  if (cached?.mode === mode) return cached.descriptor.loop;
  if (inFlight?.mode !== mode) {
    const promise = api()
      .agent.describe({ mode })
      .then((descriptor) => {
        cached = { mode, descriptor };
        api().log(
          `[loop] agent ${descriptor.id} skills=[${descriptor.skills.join(",")}] tools=[${descriptor.tools.join(",")}]`,
        );
        return descriptor;
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        api().log(`[loop] agent:describe FAILED: ${msg}`);
        return null;
      })
      .finally(() => {
        if (inFlight?.mode === mode) inFlight = null;
      });
    inFlight = { mode, promise };
  }
  const descriptor = await inFlight.promise;
  return descriptor?.loop ?? null;
}
