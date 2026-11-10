// The agent the app runs, and what the renderer is told about it.
//
// There is one agent, the coach (./coach.ts). This module is the seam between
// it and everything outside the harness: claude.ts asks for it here, and
// `agent:describe` flattens it to plain data here.

import type { AgentDescriptor } from "../types";
import type { Agent } from "./harness/types";
import { midTurnTools } from "./harness/schema";
import { coachAgent } from "./coach";

export function getAgent(): Agent {
  return coachAgent;
}

/**
 * What the renderer needs to run this agent's loop. Crosses the IPC bridge —
 * so it carries plain data only, never the skill objects or tool functions.
 */
export function describeAgent(): AgentDescriptor {
  const agent = getAgent();
  return {
    id: agent.id,
    loop: agent.loop,
    ...(agent.loopByStance ? { loopByStance: agent.loopByStance } : {}),
    skills: agent.skills.map((s) => s.id),
    tools: midTurnTools(agent).map((t) => t.name),
  };
}
