// The coach's output contract: silence is its own tool, speech streams early,
// and the shared voice and memory rules are in the prompt. Pins that
// coach.test.ts already holds (required fields, instruction position, the
// follow-up and first-look rules) live there and are not repeated here.

import { describe, expect, it } from "vitest";
import { coachAgent } from "../../electron/agents/coach";
import { systemPrompt, terminalTools } from "../../electron/agents/harness/schema";
import { parseTerminalTool } from "../../electron/agents/harness/parse-turn";

function sayTool() {
  const tool = terminalTools(coachAgent).find((t) => t.name === "say");
  if (!tool) throw new Error("the coach has no say tool");
  return tool;
}

function waitTool() {
  const tool = terminalTools(coachAgent).find((t) => t.name === "wait");
  if (!tool) throw new Error("the coach has no wait tool");
  return tool;
}

describe("the coach can choose to stay silent", () => {
  // The bug this locks: a mode with no way to express "say nothing" had its
  // silent turns parsed as "instruct" with an empty instruction, which fell
  // back to speaking the raw response aloud. Silence is now its own tool, so
  // the failure is structurally impossible rather than prompt-enforced.
  it("has a wait tool", () => {
    expect(waitTool().name).toBe("wait");
  });

  it("cannot say wait as an action", () => {
    // If "wait" were an action value on `say`, a silent turn would still be a
    // speech call and the streaming gate would have to buffer and retract.
    const action = sayTool().input_schema.properties.action as {
      enum: string[];
    };
    expect(action.enum).not.toContain("wait");
  });

  it("carries bookkeeping fields on wait", () => {
    // A silent turn must still be able to record progress — the loop has
    // always applied completed_steps and notes on every action, including
    // wait, so the agent can mark progress without speaking.
    const props = waitTool().input_schema.properties;
    expect(props).toHaveProperty("completed_steps");
    expect(props).toHaveProperty("notes");
  });

  it("carries no speech fields on wait", () => {
    const props = waitTool().input_schema.properties;
    expect(props).not.toHaveProperty("instruction");
    expect(props).not.toHaveProperty("action");
  });
});

describe("a direct question is never answered with silence", () => {
  // The bug this locks: the user typed "Done — what's next?", the coach played
  // its thinking filler ("Let me take a look."), and the model then stayed
  // silent. The user heard the filler and then nothing at all. Silence is a
  // valid answer to a still screen; it is never a valid answer to a question.
  it("points at this turn's follow-up", () => {
    expect(coachAgent.guidance.followUp.toLowerCase()).toContain("follow-up");
  });
});

describe("the shared output contract", () => {
  it("declares the cross-session memory field", () => {
    const remember = sayTool().input_schema.properties.remember as {
      properties: { kind: { enum: string[] } };
    };
    expect(remember.properties.kind.enum).toEqual([
      "setup",
      "preference",
      "history",
      "obstacle",
    ]);
  });

  it("keeps the shared voice rules", () => {
    expect(systemPrompt(coachAgent)).toContain("Sound like a human, not a script");
  });

  it("never promises to wait for a report-in", () => {
    // The app is watching the screen; asking for a thumbs-up is both wrong and
    // the fastest way to make it feel like it isn't paying attention.
    expect(systemPrompt(coachAgent)).toContain(
      'NEVER say "let me know when you\'re done"',
    );
  });

  it("refuses to remember sensitive details", () => {
    // A coach that memorizes a password is a security incident.
    expect(systemPrompt(coachAgent).toLowerCase()).toContain("sensitive");
  });
});

describe("what the coach can do on screen", () => {
  // These were pinned as tech-support-only while three agents existed. The
  // coach inherited all three behaviours from tech support.
  it("points at things on screen", () => {
    expect(sayTool().input_schema.properties).toHaveProperty("highlight");
  });

  it("bounces a silent finished step into speech (in guide)", () => {
    expect(coachAgent.speakOnStepComplete).toBe(true);
  });

  it("troubleshoots", () => {
    expect(systemPrompt(coachAgent)).toContain("Troubleshooting");
  });
});

describe("a silent turn stays silent end to end", () => {
  it("parses a wait call without inventing speech", () => {
    const parsed = parseTerminalTool(
      "wait",
      { completed_steps: ["Opened the admin panel"], notes: "" },
      [],
    );
    expect(parsed.action).toBe("wait");
    expect(parsed.instruction).toBe("");
    expect(parsed.completedSteps).toEqual(["Opened the admin panel"]);
  });

  it("keeps a wait silent even if the model fills in speech fields", () => {
    // Defence in depth: `wait` has no instruction field, but a model that
    // hallucinated one must not get it read aloud.
    const parsed = parseTerminalTool(
      "wait",
      { instruction: "Click the Save button", action: "instruct" },
      [],
    );
    expect(parsed.instruction).toBe("");
    expect(parsed.action).toBe("wait");
    expect(parsed.highlight).toBeNull();
  });

  it("never substitutes the raw payload for a missing instruction", () => {
    // The old failure mode: instruction was empty, so the parser substituted
    // the entire response text, and TTS read the JSON to the user.
    const parsed = parseTerminalTool("say", { action: "instruct" }, []);
    expect(parsed.instruction).toBe("");
  });
});
