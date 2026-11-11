// Assembles an agent's request surface — system prompt, tool definitions, and
// the terminal say/wait schemas — from its skill list.
//
// EVERYTHING HERE MUST BE BYTE-STABLE ACROSS TICKS. Tool definitions render
// ahead of the system prompt, which renders ahead of the messages, so a single
// changed byte in either invalidates the whole cached prefix and every later
// tick silently pays full price. That means: build only from the static skill
// array, never from runtime state, and never sort with a comparator that could
// tie-break differently. Plain object key order is insertion order in JS, so
// building the schema in skill order is deterministic by construction.
//
// Locked by src/__tests__/agentHarness.test.ts.

import type { Agent, AgentTool, OutputField, Skill } from "./types";
import { SAY_TOOL, WAIT_TOOL } from "./types";

/** The wire shape of a tool definition. Matches Anthropic's `tools` entry. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

const SAY_DESCRIPTION = `Speak to the user and end your turn. This is how you say anything at all — text you write anywhere else is never heard. Call this at most once per turn.`;

const WAIT_DESCRIPTION = `Say nothing and end your turn. Use this when the user is mid-step, still reading, or simply doesn't need you right now. You can still record progress, notes, and memory on this call — staying quiet does not mean losing track. Choosing wait is good coaching, not laziness.`;

/**
 * The action field. Declared here rather than in a skill because both the
 * streaming gate and the loop's pacing depend on it existing on `say` for
 * every agent — a mode that could omit it would have no way to distinguish
 * "here is the next step" from "nice work", and the loop's check-in throttle
 * would have nothing to read.
 *
 * "wait" is deliberately NOT a value here: silence is the `wait` tool.
 */
const ACTION_FIELD: OutputField = {
  name: "action",
  on: "say",
  required: true,
  schema: {
    type: "string",
    enum: ["instruct", "acknowledge", "check_in", "done", "confirm_goal"],
    description:
      "What kind of speech this is. instruct = the next concrete step. acknowledge = a short warm line for real progress that needs no direction. check_in = one friendly question after a long silence. done = the goal is visibly achieved. confirm_goal = saying the goal back and asking if it is right, before the first step.",
  },
};

function collectFields(skills: Skill[]): OutputField[] {
  const fields: OutputField[] = [ACTION_FIELD];
  const seen = new Set<string>([ACTION_FIELD.name]);
  for (const skill of skills) {
    for (const field of skill.outputFields ?? []) {
      // First skill to claim a field name wins. Two skills owning the same
      // field is a composition mistake, not something to silently merge.
      if (seen.has(field.name)) continue;
      seen.add(field.name);
      fields.push(field);
    }
  }
  return fields;
}

function buildTerminalTool(
  name: string,
  description: string,
  fields: OutputField[],
): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.name] = field.schema;
    if (field.required) required.push(field.name);
  }
  return {
    name,
    description,
    input_schema: { type: "object", properties, required },
  };
}

/** The terminal tools, in fixed order: say first, then wait. */
export function terminalTools(agent: Agent): ToolDefinition[] {
  const fields = collectFields(agent.skills);
  return [
    buildTerminalTool(
      SAY_TOOL,
      SAY_DESCRIPTION,
      fields.filter((f) => f.on === "say" || f.on === "both"),
    ),
    buildTerminalTool(
      WAIT_TOOL,
      WAIT_DESCRIPTION,
      // Silent turns carry the bookkeeping fields but nothing speech-shaped,
      // and nothing is required — a wait with an empty input is valid.
      fields
        .filter((f) => f.on === "both")
        .map((f) => ({ ...f, required: false })),
    ),
  ];
}

/** Mid-turn tools contributed by skills, in skill order. */
export function midTurnTools(agent: Agent): AgentTool[] {
  const tools: AgentTool[] = [];
  const seen = new Set<string>();
  for (const skill of agent.skills) {
    for (const tool of skill.tools ?? []) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      tools.push(tool);
    }
  }
  return tools;
}

/**
 * The full `tools` array for the request, in the order it is sent.
 * Terminal tools first so the two most-used definitions sit at the very front
 * of the cached prefix.
 */
export function toolDefinitions(agent: Agent): ToolDefinition[] {
  return [
    ...terminalTools(agent),
    ...midTurnTools(agent).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as ToolDefinition["input_schema"],
    })),
  ];
}

/**
 * The system prompt: the agent's persona, then each skill's prompt fragment in
 * skill order. Byte-identical across every tick of a session — per-tick data
 * belongs in the context header (see context.ts), never here.
 */
export function systemPrompt(agent: Agent): string {
  const parts = [agent.intro];
  for (const skill of agent.skills) {
    if (skill.systemFragment) parts.push(skill.systemFragment);
  }
  return parts.join("\n\n");
}
