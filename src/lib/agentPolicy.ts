// The renderer's cache of the current agent's loop policy.
//
// The agent declares its cadence (electron/agents/coach.ts → Agent.loop and
// Agent.loopByStance); the renderer executes it. This module is
// the seam between the two: one async fetch at session start, then a cheap
// read on every tick.
//
// Deliberately NOT a table with default values baked in. Duplicating the
// numbers here is how they drift out of sync with the agent that owns them —
// the whole point of moving the policy onto the agent is that there is
// exactly one place to change it.

import { api } from "./api";
import type { AgentDescriptor, LoopPolicy, Stance } from "./api";

// One agent, described once for the life of the app. The stance can change
// mid-session; both cadences arrive in the one descriptor, so a stance change
// never needs another fetch.
let cached: AgentDescriptor | null = null;
let inFlight: Promise<AgentDescriptor | null> | null = null;

/** The cadence for `stance`. A descriptor without stances has just the one. */
export function policyFor(
  descriptor: Pick<AgentDescriptor, "loop" | "loopByStance">,
  stance: Stance,
): LoopPolicy {
  return descriptor.loopByStance?.[stance] ?? descriptor.loop;
}

/**
 * Fetch and cache the coach's policies, and return the one for `stance`.
 * Returns null if the agent could not be described — the caller should skip
 * this tick and try again rather than guessing at a cadence.
 */
export async function ensureAgentPolicy(
  stance: Stance,
): Promise<LoopPolicy | null> {
  if (cached) return policyFor(cached, stance);
  if (!inFlight) {
    inFlight = api()
      .agent.describe()
      .then((descriptor) => {
        cached = descriptor;
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
        inFlight = null;
      });
  }
  const descriptor = await inFlight;
  return descriptor ? policyFor(descriptor, stance) : null;
}
