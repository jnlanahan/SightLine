import { describe, expect, it } from "vitest";
import { allAgents } from "../../electron/agents/registry";
import { systemPrompt, terminalTools } from "../../electron/agents/harness/schema";
import { parseTerminalTool } from "../../electron/agents/harness/parse-turn";
import type { Agent } from "../../electron/agents/harness/types";

const AGENTS: Array<[string, Agent]> = allAgents().map((a) => [a.id, a]);

function sayTool(agent: Agent) {
  const tool = terminalTools(agent).find((t) => t.name === "say");
  if (!tool) throw new Error(`agent ${agent.id} has no say tool`);
  return tool;
}

function waitTool(agent: Agent) {
  const tool = terminalTools(agent).find((t) => t.name === "wait");
  if (!tool) throw new Error(`agent ${agent.id} has no wait tool`);
  return tool;
}

describe("every agent can choose to stay silent", () => {
  // The bug this locks: a mode with no way to express "say nothing" had its
  // silent turns parsed as "instruct" with an empty instruction, which fell
  // back to speaking the raw response aloud. Silence is now its own tool, so
  // the failure is structurally impossible rather than prompt-enforced.
  it.each(AGENTS)("%s has a wait tool", (_name, agent) => {
    expect(waitTool(agent).name).toBe("wait");
  });

  it.each(AGENTS)("%s cannot say wait as an action", (_name, agent) => {
    // If "wait" were an action value on `say`, a silent turn would still be a
    // speech call and the streaming gate would have to buffer and retract.
    const action = sayTool(agent).input_schema.properties.action as {
      enum: string[];
    };
    expect(action.enum).not.toContain("wait");
  });

  it.each(AGENTS)("%s carries bookkeeping fields on wait", (_name, agent) => {
    // A silent turn must still be able to record progress — the loop has
    // always applied completed_steps and notes on every action, including
    // wait, so the agent can mark progress without speaking.
    const props = waitTool(agent).input_schema.properties;
    expect(props).toHaveProperty("completed_steps");
    expect(props).toHaveProperty("notes");
  });

  it.each(AGENTS)("%s carries no speech fields on wait", (_name, agent) => {
    const props = waitTool(agent).input_schema.properties;
    expect(props).not.toHaveProperty("instruction");
    expect(props).not.toHaveProperty("action");
  });

  it.each(AGENTS)("%s requires nothing to call wait", (_name, agent) => {
    // A wait must be cheap and always valid; a required field would give the
    // model a reason to speak instead.
    expect(waitTool(agent).input_schema.required).toEqual([]);
  });
});

describe("speech streams as early as possible", () => {
  it.each(AGENTS)("%s requires an instruction to speak", (_name, agent) => {
    expect(sayTool(agent).input_schema.required).toContain("instruction");
  });

  it.each(AGENTS)("%s puts instruction near the front of say", (_name, agent) => {
    // Schema property order biases generation order, and TTS starts on the
    // first finished sentence of `instruction`. Burying it behind the
    // bookkeeping fields would delay every spoken word by the time it takes
    // to generate the rest of the turn.
    const keys = Object.keys(sayTool(agent).input_schema.properties);
    expect(keys[0]).toBe("action");
    expect(keys.indexOf("instruction")).toBeLessThanOrEqual(2);
  });
});

describe("a direct question is never answered with silence", () => {
  // The bug this locks: the user typed "Done — what's next?", the coach played
  // its thinking filler ("Let me take a look."), and the model then stayed
  // silent. The user heard the filler and then nothing at all. Silence is a
  // valid answer to a still screen; it is never a valid answer to a question.
  it.each(AGENTS)("%s forbids wait on a follow-up turn", (_name, agent) => {
    expect(agent.guidance.followUp).toContain("never wait");
  });

  it.each(AGENTS)("%s points at this turn's follow-up", (_name, agent) => {
    expect(agent.guidance.followUp.toLowerCase()).toContain("follow-up");
  });

  it.each(AGENTS)("%s must speak on the first turn", (_name, agent) => {
    expect(agent.guidance.sessionStart).toContain("Do not call wait");
  });
});

describe("every agent shares the same output contract", () => {
  it.each(AGENTS)("%s declares the cross-session memory field", (_name, agent) => {
    const remember = sayTool(agent).input_schema.properties.remember as {
      properties: { kind: { enum: string[] } };
    };
    expect(remember.properties.kind.enum).toEqual([
      "setup",
      "preference",
      "history",
      "obstacle",
    ]);
  });

  it.each(AGENTS)("%s keeps the shared voice rules", (_name, agent) => {
    expect(systemPrompt(agent)).toContain("Sound like a human, not a script");
  });

  it.each(AGENTS)("%s never promises to wait for a report-in", (_name, agent) => {
    // The app is watching the screen; asking for a thumbs-up is both wrong and
    // the fastest way to make it feel like it isn't paying attention.
    expect(systemPrompt(agent)).toContain(
      'NEVER say "let me know when you\'re done"',
    );
  });

  it.each(AGENTS)("%s refuses to remember sensitive details", (_name, agent) => {
    // A coach that memorizes a password is a security incident.
    expect(systemPrompt(agent).toLowerCase()).toContain("sensitive");
  });
});

describe("agent roles stay distinct", () => {
  const byId = Object.fromEntries(allAgents().map((a) => [a.id, a]));

  it("tech support directs, training does not", () => {
    expect(systemPrompt(byId.training)).toContain(
      "Never tell the user how to do something",
    );
    expect(systemPrompt(byId.tech_support)).toContain("one concrete step at a time");
  });

  it("training treats silence as the default", () => {
    expect(systemPrompt(byId.training)).toContain(
      "overwhelming majority of your turns",
    );
  });

  it("teacher is conversational rather than screen-driven", () => {
    expect(systemPrompt(byId.teacher)).toContain("This is a CONVERSATION");
  });

  it("only tech support points at things on screen", () => {
    // The other two have no highlight field at all, so neither can draw a box
    // on the user's screen even if it wanted to.
    expect(sayTool(byId.tech_support).input_schema.properties).toHaveProperty(
      "highlight",
    );
    expect(sayTool(byId.training).input_schema.properties).not.toHaveProperty(
      "highlight",
    );
    expect(sayTool(byId.teacher).input_schema.properties).not.toHaveProperty(
      "highlight",
    );
  });

  it("only tech support bounces a silent finished step into speech", () => {
    // Training's scans record steps on wait by design; bouncing them would
    // turn the quiet coach into a running commentary.
    expect(byId.tech_support.speakOnStepComplete).toBe(true);
    expect(byId.training.speakOnStepComplete).toBeFalsy();
    expect(byId.teacher.speakOnStepComplete).toBeFalsy();
  });

  it("only tech support troubleshoots", () => {
    expect(systemPrompt(byId.tech_support)).toContain("Troubleshooting");
    expect(waitTool(byId.training).input_schema.properties).not.toHaveProperty(
      "troubleshooting",
    );
    expect(waitTool(byId.teacher).input_schema.properties).not.toHaveProperty(
      "troubleshooting",
    );
  });
});

describe("training grades only out loud", () => {
  const byId = Object.fromEntries(allAgents().map((a) => [a.id, a]));

  it("the verdict and mistake fields live on say alone", () => {
    // A wait carrying a verdict would advance the plan without the user ever
    // hearing why — grading is speech by construction.
    const say = sayTool(byId.training).input_schema.properties;
    const wait = waitTool(byId.training).input_schema.properties;
    expect(say).toHaveProperty("task_verdict");
    expect(say).toHaveProperty("mistake_pattern");
    expect(wait).not.toHaveProperty("task_verdict");
    expect(wait).not.toHaveProperty("mistake_pattern");
    // Training-only: the other agents have no grading surface at all.
    expect(sayTool(byId.tech_support).input_schema.properties).not.toHaveProperty(
      "task_verdict",
    );
  });

  it("parses a spoken verdict and drops everything else", () => {
    const passed = parseTerminalTool(
      "say",
      { action: "instruct", instruction: "Nice work.", task_verdict: "pass" },
      [],
    );
    expect(passed.taskVerdict).toBe("pass");
    // An invalid enum value must not advance the plan.
    const bogus = parseTerminalTool(
      "say",
      { action: "instruct", instruction: "Hm.", task_verdict: "maybe" },
      [],
    );
    expect(bogus.taskVerdict).toBeNull();
    // A wait can never grade, even if the model hallucinates the field.
    const silent = parseTerminalTool("wait", { task_verdict: "pass" }, []);
    expect(silent.taskVerdict).toBeNull();
    expect(silent.mistakePattern).toBe("");
  });

  it("scans are told they are never a reason to speak", () => {
    expect(byId.training.nextTurnPrompt).toContain("never a reason to speak");
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
