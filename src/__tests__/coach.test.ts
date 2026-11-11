// The one coach: a single agent that guides step by step or watches quietly,
// and picks which. These lock the things that break the product when they
// drift — the cached prefix, the two cadences, and the rules that keep each
// stance from behaving like the other.

import { describe, expect, it } from "vitest";
import { coachAgent, COACH_LOOPS } from "../../electron/agents/coach";
import { describeAgent, getAgent } from "../../electron/agents/registry";
import {
  midTurnTools,
  systemPrompt,
  terminalTools,
  toolDefinitions,
} from "../../electron/agents/harness/schema";
import { buildContextHeader, describeAway } from "../../electron/agents/harness/context";
import { parseTerminalTool } from "../../electron/agents/harness/parse-turn";
import type { TurnContext } from "../../electron/agents/harness/types";
import { policyFor } from "../lib/agentPolicy";

function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    goal: "Teach me pivot tables",
    completedSteps: [],
    upcomingSteps: [],
    conversation: [],
    frames: [],
    ...overrides,
  };
}

describe("the coach is the agent the app runs", () => {
  it("is what every session resolves to", () => {
    expect(getAgent()).toBe(coachAgent);
  });
});

describe("the coach's cached prefix", () => {
  it("keeps its skills in a fixed order", () => {
    // Prompt order AND tool order. Changing this re-writes the cache for
    // every session, so it should only ever change on purpose.
    expect(coachAgent.skills.map((s) => s.id)).toEqual([
      "speech",
      "pacing",
      "verify",
      "troubleshoot",
      "research",
      "screenReading",
      // Added for plan step 8 (search past chats). Directly after the zoom
      // lens, on purpose; it moved the cache prefix once.
      "pastChats",
      "plan",
      "stages",
      "pointing",
      "notes",
      "memory",
    ]);
  });

  it("offers exactly five tools, terminal tools first", () => {
    expect(toolDefinitions(coachAgent).map((t) => t.name)).toEqual([
      "say",
      "wait",
      "search_web",
      "read_screen_region",
      "search_memory",
    ]);
    // No plan-edit tools: each one is a round trip the user waits through.
    expect(midTurnTools(coachAgent).map((t) => t.name)).not.toContain("plan_add_step");
  });

  it("searches earlier chats only when it helps, and never reads results out", () => {
    const prompt = systemPrompt(coachAgent);
    expect(prompt).toContain("search_memory");
    expect(prompt).toContain("Don't use it on every look");
    expect(prompt).toContain("never read the results back as a list");
  });

  it("is byte-identical from one look to the next", () => {
    expect(systemPrompt(coachAgent)).toBe(systemPrompt(coachAgent));
    expect(JSON.stringify(toolDefinitions(coachAgent))).toBe(
      JSON.stringify(toolDefinitions(coachAgent)),
    );
  });

  it("never carries the current stance — that is per-look data", () => {
    expect(systemPrompt(coachAgent)).not.toContain("Current stance:");
  });
});

describe("what the coach fills in each turn", () => {
  const [say, wait] = terminalTools(coachAgent);
  const sayFields = Object.keys(say.input_schema.properties);
  const waitFields = Object.keys(wait.input_schema.properties);

  it("puts the spoken text at the front so speech can start mid-generation", () => {
    expect(sayFields[0]).toBe("action");
    expect(sayFields.indexOf("instruction")).toBeLessThanOrEqual(2);
    expect(say.input_schema.required).toEqual(["action", "instruction"]);
  });

  it("can change stance on a spoken or a silent turn", () => {
    expect(sayFields).toContain("stance");
    expect(waitFields).toContain("stance");
  });

  it("requires nothing on a silent turn", () => {
    expect(wait.input_schema.required).toEqual([]);
    expect(waitFields).not.toContain("instruction");
  });

  it("fills exactly these fields, in this order", () => {
    // Pinned on purpose: these schemas sit in the cached prefix, so any change
    // re-writes the cache once. Step 6 added note_seen (and "seen" inside
    // remember); step 7 added stages and stage — the deliberate change that
    // last moved this pin.
    expect(sayFields).toEqual([
      "action",
      "instruction",
      "code",
      "expected_pace",
      "stance",
      "expected_result",
      "troubleshooting",
      "completed_steps",
      "upcoming_steps",
      "digression",
      "stages",
      "stage",
      "highlight",
      "notes",
      "note_seen",
      "remember",
    ]);
    expect(waitFields).toEqual([
      "stance",
      "troubleshooting",
      "completed_steps",
      "upcoming_steps",
      "digression",
      "stages",
      "stage",
      "notes",
      "note_seen",
      "remember",
    ]);
  });

  it("can say whether a note or a fact was seen on screen, on either turn", () => {
    for (const tool of [say, wait]) {
      const props = tool.input_schema.properties as Record<string, { type: string; properties?: Record<string, { type: string }> }>;
      expect(props.note_seen.type).toBe("boolean");
      expect(props.remember.properties!.seen.type).toBe("boolean");
    }
    // Optional everywhere: leaving it out means "not seen".
    expect(say.input_schema.required).not.toContain("note_seen");
  });

  it("has dropped the training-only and teacher-only fields", () => {
    for (const gone of ["task_verdict", "mistake_pattern", "needsResearch", "researchQuery"]) {
      expect(sayFields).not.toContain(gone);
      expect(waitFields).not.toContain(gone);
    }
  });
});

describe("the coach's rules", () => {
  const prompt = systemPrompt(coachAgent);

  it("stays quiet by default", () => {
    expect(prompt).toContain("You stay quiet far more than you talk");
    expect(prompt).toContain("Choosing wait is good coaching, not laziness");
  });

  it("gives the next step the moment one is finished — in guide", () => {
    expect(prompt).toContain("In guide a finished step is never a wait");
  });

  it("never speaks on a routine look — in watch", () => {
    expect(prompt).toContain("In watch, a look at the screen is never a reason to speak");
    expect(prompt).toContain("Never jump in with a correction");
  });

  it("switches on the user's own words", () => {
    expect(prompt).toContain('"just watch"');
    expect(prompt).toContain('"talk me through it"');
  });

  it("checks work against what done looks like, and only passes what is there", () => {
    expect(prompt).toContain("expected_result");
    expect(prompt).toContain("Fix at most ONE thing per response");
    expect(prompt).toContain("Never pass work that isn't there");
  });

  it("takes plain words, not bracketed button markers", () => {
    expect(prompt).not.toContain("[check-my-work]");
    expect(prompt).not.toContain("[stuck]");
    expect(prompt).toContain('"check my work"');
    expect(prompt).toContain('"I\'m stuck"');
  });

  it("starts in one look: no wait, no done, and a stance, on the first turn", () => {
    expect(coachAgent.guidance.sessionStart).toContain("Do not call wait");
    expect(coachAgent.guidance.sessionStart).toContain('set "stance" on this turn');
    expect(coachAgent.guidance.sessionStart).toContain("one question, not a list");
  });

  it("always answers a direct question out loud, in either stance", () => {
    expect(coachAgent.guidance.followUp).toContain("never wait");
    expect(coachAgent.guidance.followUp).toContain("whichever stance");
  });

  it("does not end a turn by contradicting the follow-up rule", () => {
    // The old training prompt closed every turn with "a scan is never a reason
    // to speak" — right after being told a follow-up must be answered.
    expect(coachAgent.nextTurnPrompt).toContain("unless they said something to you");
  });

  it("has no setup prompts — the first look replaces the setup calls", () => {
    // The fields are gone from the Agent type; this also catches one being
    // added back on the coach object itself.
    expect("clarificationPrompt" in coachAgent).toBe(false);
    expect("planPrompt" in coachAgent).toBe(false);
  });
});

describe("the two cadences", () => {
  it("guide looks often and reacts to input", () => {
    expect(COACH_LOOPS.guide).toEqual({
      minCallSpacingMs: 3_000,
      normalIntervalMs: 15_000,
      slowIntervalMs: 30_000,
      quietPeriodMs: 1_500,
      stallEnabled: true,
      requireScreenChange: true,
    });
  });

  it("watch looks rarely, ignores input, and never checks in", () => {
    expect(COACH_LOOPS.watch).toEqual({
      minCallSpacingMs: 10_000,
      normalIntervalMs: 60_000,
      slowIntervalMs: 120_000,
      quietPeriodMs: 0,
      stallEnabled: false,
      requireScreenChange: true,
    });
  });

  it("both cross the bridge in one descriptor, as plain data", () => {
    const descriptor = describeAgent();
    expect(descriptor.loopByStance).toEqual(COACH_LOOPS);
    expect(() => JSON.stringify(descriptor)).not.toThrow();
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
  });

  it("the renderer picks by stance, and falls back for an agent without stances", () => {
    const descriptor = describeAgent();
    expect(policyFor(descriptor, "guide")).toEqual(COACH_LOOPS.guide);
    expect(policyFor(descriptor, "watch")).toEqual(COACH_LOOPS.watch);
    const single = { loop: COACH_LOOPS.guide };
    expect(policyFor(single, "watch")).toEqual(COACH_LOOPS.guide);
  });
});

describe("the per-look context", () => {
  it("tells the coach which stance it is in", () => {
    expect(buildContextHeader(coachAgent, ctx({ stance: "watch" }), 1)).toContain(
      "Current stance: watch.",
    );
    expect(buildContextHeader(coachAgent, ctx({ stance: "guide" }), 1)).toContain(
      "Current stance: guide.",
    );
  });

  it("frames the expected result as a check in guide and as a rubric in watch", () => {
    const guide = buildContextHeader(
      coachAgent,
      ctx({ stance: "guide", lastExpectedResult: "the pivot table shows totals" }),
      1,
    );
    expect(guide).toContain("Check the latest screenshot for it before advancing");

    const watch = buildContextHeader(
      coachAgent,
      ctx({ stance: "watch", lastExpectedResult: "the pivot table shows totals" }),
      1,
    );
    expect(watch).toContain("Grade against it only when the user asks you to check");
    expect(watch).not.toContain("before advancing");
  });

  it("does not invite an unprompted hint while watching", () => {
    const conversation = [
      { role: "assistant" as const, content: "Build a pivot table from this sheet.", timestamp: 1 },
    ];
    const watch = buildContextHeader(coachAgent, ctx({ stance: "watch", conversation }), 1);
    expect(watch).not.toContain("smaller hint");
    const guide = buildContextHeader(coachAgent, ctx({ stance: "guide", conversation }), 1);
    expect(guide).toContain("smaller hint");
  });
});

describe("coming back to a chat", () => {
  const resuming = {
    awayMinutes: 26 * 60,
    whereWeLeftOff: "Done so far: Built the pivot table. Next: Group the dates by month.",
  };

  it("tells the coach how long it has been and where things were left", () => {
    const header = buildContextHeader(coachAgent, ctx({ stance: "watch", resuming }), 1);
    expect(header).toContain("come back to this chat after about 26 hours away");
    expect(header).toContain("Where it was left: Done so far: Built the pivot table.");
  });

  it("asks for a spoken greeting, not a silent look", () => {
    const header = buildContextHeader(coachAgent, ctx({ stance: "watch", resuming }), 1);
    expect(header).toContain("The user just reopened this chat");
    expect(coachAgent.guidance.resume).toContain("never wait");
    expect(coachAgent.guidance.resume).toContain("an offer to pick up from there");
  });

  it("says nothing about returning on an ordinary look", () => {
    const header = buildContextHeader(coachAgent, ctx({ stance: "watch" }), 1);
    expect(header).not.toContain("reopened this chat");
    expect(header).not.toContain("come back to this chat");
  });

  it("describes the gap in plain words", () => {
    expect(describeAway(0.5)).toBe("a moment");
    expect(describeAway(20)).toBe("about 20 minutes");
    expect(describeAway(3 * 60)).toBe("about 3 hours");
    expect(describeAway(3 * 24 * 60)).toBe("about 3 days");
  });
});

describe("parsing a coach turn", () => {
  it("reads a stance change from a spoken or a silent turn", () => {
    expect(
      parseTerminalTool("say", { action: "instruct", instruction: "Go.", stance: "watch" }, [])
        .stance,
    ).toBe("watch");
    expect(parseTerminalTool("wait", { stance: "guide" }, []).stance).toBe("guide");
  });

  it("treats a missing or unknown stance as no change", () => {
    expect(parseTerminalTool("wait", {}, []).stance).toBeNull();
    expect(parseTerminalTool("wait", { stance: "hover" }, []).stance).toBeNull();
  });

  it("keeps the plan when a turn leaves upcoming_steps out", () => {
    // The bug this locks: every field on wait is optional, and an omitted
    // upcoming_steps used to parse as [] — so any silent look wiped the plan.
    const plan = ["Insert the pivot table", "Add Month to rows"];
    expect(parseTerminalTool("wait", {}, [], plan).upcomingSteps).toEqual(plan);
    expect(
      parseTerminalTool("say", { action: "acknowledge", instruction: "Nice." }, [], plan)
        .upcomingSteps,
    ).toEqual(plan);
  });

  it("still lets the coach clear or replace the plan on purpose", () => {
    const plan = ["Insert the pivot table"];
    expect(parseTerminalTool("wait", { upcoming_steps: [] }, [], plan).upcomingSteps).toEqual([]);
    expect(
      parseTerminalTool("wait", { upcoming_steps: ["Sort by total"] }, [], plan).upcomingSteps,
    ).toEqual(["Sort by total"]);
  });
});

describe("a long goal has stages", () => {
  const prompt = systemPrompt(coachAgent);

  it("lays out a few stages and plans only the current one in detail", () => {
    expect(prompt).toContain("3 to 8 stages");
    expect(prompt).toContain('"upcoming_steps" holds the steps of the CURRENT stage only');
    expect(prompt).toContain("A quick question or a short walkthrough has no stages");
  });

  it("shows the coach where the user is in the plan, each look", () => {
    const header = buildContextHeader(
      coachAgent,
      ctx({ stages: ["Shape the data", "Build the table", "Group by month"], stageIndex: 1 }),
      1,
    );
    expect(header).toContain("Plan stages (the user is on stage 2 of 3):");
    expect(header).toContain("1. Shape the data — done");
    expect(header).toContain("2. Build the table — current");
    expect(header).toContain("3. Group by month");
    expect(header).not.toContain("3. Group by month —");
  });

  it("says nothing about stages for a chat without them", () => {
    expect(buildContextHeader(coachAgent, ctx(), 1)).not.toContain("Plan stages");
  });

  it("reads the stage list and the current stage from either kind of turn", () => {
    const laidOut = parseTerminalTool(
      "say",
      {
        action: "instruct",
        instruction: "Here's the plan.",
        stages: ["Shape the data", " Build the table ", ""],
        stage: 1,
      },
      [],
    );
    expect(laidOut.stages).toEqual(["Shape the data", "Build the table"]);
    expect(laidOut.stageNumber).toBe(1);
    expect(parseTerminalTool("wait", { stage: 2 }, []).stageNumber).toBe(2);
  });

  it("treats anything unusable as no change", () => {
    const silent = parseTerminalTool("wait", {}, []);
    expect(silent.stages).toBeNull();
    expect(silent.stageNumber).toBeNull();
    expect(parseTerminalTool("wait", { stages: [], stage: 0 }, []).stages).toBeNull();
    expect(parseTerminalTool("wait", { stage: 0 }, []).stageNumber).toBeNull();
    expect(parseTerminalTool("wait", { stage: "2" }, []).stageNumber).toBeNull();
    expect(parseTerminalTool("wait", { stage: 1.5 }, []).stageNumber).toBeNull();
  });
});
