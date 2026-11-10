// The harness, exercised through the one agent it runs. coach.test.ts pins
// the coach itself (skill order, the exact tool list, the two cadences, its
// rules); this file pins the machinery that assembles any agent: the cached
// prefix, how skills become schemas and context, and what crosses the bridge.

import { describe, expect, it } from "vitest";
import { describeAgent, getAgent } from "../../electron/agents/registry";
import {
  midTurnTools,
  systemPrompt,
  terminalTools,
} from "../../electron/agents/harness/schema";
import { buildContextHeader } from "../../electron/agents/harness/context";
import type { TurnContext } from "../../electron/agents/harness/types";

const agent = getAgent();

function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    goal: "Set up a VPN",
    completedSteps: [],
    upcomingSteps: [],
    conversation: [],
    frames: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Prompt caching. Tools render before system, which renders before messages,
// so a byte change in either prefix re-writes the cache for the whole session
// and every later tick silently pays full price. (Byte-identity itself and the
// tool list are pinned in coach.test.ts.)
// ---------------------------------------------------------------------------

describe("the cached prefix is byte-stable", () => {
  it("keeps per-tick data out of the system prompt", () => {
    // Anything that varies tick to tick belongs in the context header, after
    // the cache breakpoint. A timestamp or a step count leaking in here is the
    // classic way a cache hit rate collapses to zero.
    const prompt = systemPrompt(agent);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/); // a date
    expect(prompt).not.toMatch(/\bscreen last changed\b/);
    expect(prompt).not.toContain("Original goal:");
  });
});

// ---------------------------------------------------------------------------
// Schema assembly from skills
// ---------------------------------------------------------------------------

describe("skills assemble into the terminal tools", () => {
  it("a skill's output fields land on the tools it declared", () => {
    const say = terminalTools(agent).find((t) => t.name === "say")!;
    const wait = terminalTools(agent).find((t) => t.name === "wait")!;
    // check declares expected_result "on: say" — speech-only.
    expect(say.input_schema.properties).toHaveProperty("expected_result");
    expect(wait.input_schema.properties).not.toHaveProperty("expected_result");
    // notes declares "on: both" — a silent turn can still record one.
    expect(say.input_schema.properties).toHaveProperty("notes");
    expect(wait.input_schema.properties).toHaveProperty("notes");
  });

  it("every mid-turn tool declares an object schema with required fields", () => {
    for (const tool of midTurnTools(agent)) {
      expect(tool.inputSchema.type).toBe("object");
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Context blocks
// ---------------------------------------------------------------------------

describe("skills contribute per-turn context", () => {
  it("the check skill round-trips the previous expected result", () => {
    const header = buildContextHeader(
      agent,
      ctx({ lastExpectedResult: "the query editor opens" }),
      1,
    );
    expect(header).toContain("the query editor opens");
  });

  it("situational guidance comes last, after the skill blocks", () => {
    const header = buildContextHeader(agent, ctx({ stalled: true }), 1);
    expect(header.indexOf(agent.guidance.stalled)).toBeGreaterThan(
      header.indexOf("Original goal:"),
    );
    expect(header.endsWith(agent.nextTurnPrompt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Turn budget. (The cadences themselves are pinned in coach.test.ts.)
// ---------------------------------------------------------------------------

describe("the turn budget", () => {
  it("allows at least one turn", () => {
    // maxToolIterations < 1 would mean the runner never calls the model.
    expect(agent.maxToolIterations).toBeGreaterThanOrEqual(1);
  });

  it("leaves room to use a mid-turn tool and still speak", () => {
    expect(midTurnTools(agent).length).toBeGreaterThan(0);
    expect(agent.maxToolIterations).toBeGreaterThanOrEqual(2);
  });
});

describe("describeAgent carries only what crosses the bridge", () => {
  it("describes as plain data", () => {
    const descriptor = describeAgent();
    expect(descriptor.loop).toEqual(agent.loop);
    expect(descriptor.skills).toEqual(agent.skills.map((s) => s.id));
    // Must survive structured clone across IPC — no functions, no classes.
    expect(() => structuredClone(descriptor)).not.toThrow();
  });
});
