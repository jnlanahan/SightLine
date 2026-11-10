// Mode → agent. The one place the three agents are enumerated.
//
// Adding a fourth mode means writing an agent module and adding it here;
// nothing in claude.ts, main.ts, or the renderer loop needs to know about it.

import type { AgentDescriptor, AppMode } from "../types";
import type { Agent } from "./harness/types";
import { midTurnTools } from "./harness/schema";
import { techSupportAgent } from "./tech-support";
import { trainingAgent } from "./training";
import { teacherAgent } from "./teacher";
import { coachAgent } from "./coach";

// The coach is the agent the app runs. The other three are the pre-merge
// agents: unreachable from the UI, kept (with their tests) until the removal
// step of docs/ONE-COACH-PLAN.md.
const AGENTS: Record<AppMode, Agent> = {
  tech_support: techSupportAgent,
  training: trainingAgent,
  teacher: teacherAgent,
  coach: coachAgent,
};

export function getAgent(mode: AppMode | null | undefined): Agent {
  return AGENTS[(mode ?? "coach") as AppMode] ?? coachAgent;
}

/** The three pre-merge agents. Exists for their tests; see the note above. */
export function allAgents(): Agent[] {
  return [techSupportAgent, trainingAgent, teacherAgent];
}

/**
 * What the renderer needs to run this agent's loop. Crosses the IPC bridge —
 * so it carries plain data only, never the skill objects or tool functions.
 */
export function describeAgent(mode: AppMode): AgentDescriptor {
  const agent = getAgent(mode);
  return {
    id: agent.id,
    loop: agent.loop,
    ...(agent.loopByStance ? { loopByStance: agent.loopByStance } : {}),
    skills: agent.skills.map((s) => s.id),
    tools: midTurnTools(agent).map((t) => t.name),
  };
}
