import { beforeEach, describe, expect, it } from "vitest";
import {
  assignStepPhases,
  buildPhaseView,
  diffPlan,
  groupTurns,
  layoutOf,
  stickyLayout,
  trackCurrentTitle,
  type PhaseInput,
} from "../lib/phaseView";
import type { ConversationTurn } from "../../electron/types";
import { useSession } from "../store/session";

function input(over: Partial<PhaseInput> = {}): PhaseInput {
  return {
    stages: [],
    stageIndex: 0,
    stepLog: [],
    currentInstruction: "",
    upcomingSteps: [],
    conversation: [],
    done: false,
    ...over,
  };
}

const turn = (role: ConversationTurn["role"], content: string, timestamp: number, tags: Partial<ConversationTurn> = {}): ConversationTurn => ({
  role,
  content,
  timestamp,
  ...tags,
});

describe("layoutOf (DATA §2)", () => {
  it("is quick with no steps", () => {
    expect(layoutOf(input())).toBe("quick");
    expect(layoutOf(input({ currentInstruction: "Click File." }))).toBe("quick");
  });

  it("is single with steps and no stages", () => {
    expect(layoutOf(input({ currentInstruction: "Click File.", upcomingSteps: ["Save"] }))).toBe("single");
    expect(
      layoutOf(input({ stepLog: [{ text: "a", at: 1 }, { text: "b", at: 2 }], done: true })),
    ).toBe("single");
  });

  it("is phased with two or more stages", () => {
    expect(layoutOf(input({ stages: ["One", "Two"] }))).toBe("phased");
  });

  it("treats one stage as single", () => {
    expect(layoutOf(input({ stages: ["Only"] }))).toBe("quick");
    expect(
      layoutOf(input({ stages: ["Only"], currentInstruction: "Do it.", upcomingSteps: ["Next"] })),
    ).toBe("single");
  });

  it("never drops back to quick within a sitting", () => {
    expect(stickyLayout("quick", "single")).toBe("single");
    expect(stickyLayout("quick", "phased")).toBe("phased");
    expect(stickyLayout("quick", undefined)).toBe("quick");
    expect(stickyLayout("phased", "single")).toBe("phased");
    const v = buildPhaseView(input({ currentInstruction: "Last one." }), { layoutFloor: "single" });
    expect(v.layout).toBe("single");
  });
});

describe("done steps → phases (DATA §3.1)", () => {
  const stages = ["Get there", "Add it", "Test it"];

  it("follows matched stage titles", () => {
    expect(
      assignStepPhases(
        [
          { text: "a", at: 1, stage: "Get there" },
          { text: "b", at: 2, stage: "Add it" },
          { text: "c", at: 3, stage: "Test it" },
        ],
        stages,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("keeps old entries with no stage in the phase before", () => {
    expect(
      assignStepPhases(
        [
          { text: "a", at: 1 },
          { text: "b", at: 2, stage: "Add it" },
          { text: "c", at: 3 },
        ],
        stages,
      ),
    ).toEqual([0, 1, 1]);
  });

  it("keeps a renamed stage's steps in the phase before", () => {
    expect(
      assignStepPhases(
        [
          { text: "a", at: 1, stage: "Get there" },
          { text: "b", at: 2, stage: "Add the connection (old name)" },
        ],
        stages,
      ),
    ).toEqual([0, 0]);
  });
});

describe("the current step's title (DATA §3.2)", () => {
  it("takes the previous turn's first upcoming phrase", () => {
    const t0 = { stepCount: 0, upcoming: ["Open Settings", "Click Add VPN"], title: "" };
    const t1 = trackCurrentTitle(t0, {
      stepLog: [{ text: "Opened the start menu", at: 1 }],
      upcomingSteps: ["Click Add VPN", "Paste the server"],
    });
    expect(t1.title).toBe("Open Settings");
  });

  it("skips a queued phrase that was itself just finished", () => {
    const t1 = trackCurrentTitle(
      { stepCount: 0, upcoming: ["Open Settings", "Click Add VPN"], title: "" },
      { stepLog: [{ text: "open settings", at: 1 }], upcomingSteps: ["Paste the server"] },
    );
    expect(t1.title).toBe("Click Add VPN");
  });

  it("falls back to no title", () => {
    const t1 = trackCurrentTitle(
      { stepCount: 0, upcoming: [], title: "" },
      { stepLog: [{ text: "a", at: 1 }], upcomingSteps: [] },
    );
    expect(t1.title).toBe("");
    const v = buildPhaseView(input({ currentInstruction: "Click the button.", upcomingSteps: ["x"] }));
    expect(v.phases[0].steps[0].title).toBe("");
  });

  it("is unchanged by a turn that finishes nothing", () => {
    const t = { stepCount: 1, upcoming: ["b"], title: "Open Settings" };
    expect(trackCurrentTitle(t, { stepLog: [{ text: "a", at: 1 }], upcomingSteps: ["c"] }).title).toBe(
      "Open Settings",
    );
  });
});

describe("diffPlan (DATA §4)", () => {
  const plan = (upcomingSteps: string[], stages: string[] = []) => ({ upcomingSteps, stages });

  it("tail growth of the window is not a change", () => {
    const d = diffPlan(plan(["B", "C", "D"]), plan(["C", "D", "E"]), ["B"]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.notes).toEqual([]);
    expect(diffPlan(plan(["B", "C"]), plan(["B", "C", "D"]), []).notes).toEqual([]);
  });

  it("an insertion inside the window is added", () => {
    const d = diffPlan(plan(["B", "C", "D"]), plan(["B", "X", "C"]), []);
    expect(d.added).toEqual(["X"]);
    // D was pushed off the end of the window, not taken out.
    expect(d.removed).toEqual([]);
    expect(d.notes).toEqual(['Plan updated: added "X"']);
  });

  it("an insertion at the front after a step finished is added", () => {
    const d = diffPlan(plan(["B", "C", "D"]), plan(["X", "C", "D"]), ["B"]);
    expect(d.added).toEqual(["X"]);
  });

  it("a removal", () => {
    const d = diffPlan(plan(["B", "C", "D"]), plan(["B", "D"]), []);
    expect(d.removed).toEqual(["C"]);
    expect(d.notes).toEqual(['Plan updated: removed "C"']);
  });

  it("a completed step is not a removal", () => {
    expect(diffPlan(plan(["B", "C"]), plan(["C"]), ["B"]).removed).toEqual([]);
  });

  it("a rephrase becomes one note", () => {
    const d = diffPlan(plan(["B", "C", "D"]), plan(["B", "C2", "D"]), []);
    expect(d.added).toEqual(["C2"]);
    expect(d.removed).toEqual(["C"]);
    expect(d.notes).toEqual(["Plan updated: 1 steps changed"]);
  });

  it("a stage added", () => {
    const d = diffPlan(plan([], ["One", "Two"]), plan([], ["One", "Two", "Three"]), []);
    expect(d.addedPhases).toEqual(["Three"]);
    expect(d.notes).toEqual(['Plan updated: added phase "Three"']);
  });

  it("the first plan arriving is not a plan change", () => {
    expect(diffPlan(plan([]), plan(["A", "B"], ["One", "Two"]), []).notes).toEqual([]);
  });

  it("a turn that leaves the list out keeps the plan", () => {
    expect(diffPlan(plan(["B", "C"]), plan([]), []).notes).toEqual([]);
  });

  it("ignores case and spacing", () => {
    expect(diffPlan(plan(["Open  Settings"]), plan(["open settings", "Next"]), []).notes).toEqual([]);
  });

  // The coach's list holds what comes AFTER the step in progress, so the
  // phrase at the front leaves the list the moment that step begins. Driving
  // the real screen on 11 November 2026 showed a false "removed" note on
  // nearly every new step until the diff was told how many steps had begun.
  describe("a step beginning is progress, not a removal", () => {
    it("the first step after the goal is agreed", () => {
      expect(diffPlan(plan(["Open Settings", "Open Network"]), plan(["Open Network"]), [], 1).notes).toEqual([]);
    });

    it("ordinary progress: one step finishes, the next one begins, the window slides", () => {
      const d = diffPlan(plan(["B", "C", "D"]), plan(["C", "D", "E"]), ["Did A"], 1);
      expect(d.notes).toEqual([]);
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([]);
    });

    it("an insertion on the same turn is still an insertion, and only that", () => {
      const d = diffPlan(plan(["Name it", "Save"]), plan(["Install the certificate", "Save"]), ["Clicked Add"], 1);
      expect(d.added).toEqual(["Install the certificate"]);
      expect(d.notes).toEqual(['Plan updated: added "Install the certificate"']);
    });

    it("the inserted step later beginning is not its removal", () => {
      expect(diffPlan(plan(["Install the certificate", "Save"]), plan(["Save"]), ["Named it"], 1).notes).toEqual([]);
    });

    it("a step the coach had not queued leaves the queue alone", () => {
      expect(diffPlan(plan(["B", "C"]), plan(["B", "C"]), [], 1).notes).toEqual([]);
    });

    it("a real removal further down the list is still noted", () => {
      const d = diffPlan(plan(["B", "C", "D"]), plan(["C"]), ["Did A"], 1);
      expect(d.removed).toEqual(["D"]);
    });

    it("with no step begun, a phrase leaving the front is a removal as before", () => {
      expect(diffPlan(plan(["B", "C"]), plan(["C"]), [], 0).removed).toEqual(["B"]);
    });
  });
});

describe("turn grouping (DATA §5)", () => {
  const log = [
    { text: "one", at: 100 },
    { text: "two", at: 200 },
  ];

  it("uses tagged steps", () => {
    const b = groupTurns(
      [turn("assistant", "a", 50, { step: 1 }), turn("assistant", "b", 150, { step: 2 }), turn("user", "c", 250, { step: 3 })],
      log,
      3,
    );
    expect(b.map((x) => x.map((t) => t.content))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups untagged turns by time", () => {
    const b = groupTurns(
      [turn("assistant", "a", 50), turn("user", "b", 100), turn("assistant", "c", 150)],
      log,
      3,
    );
    expect(b.map((x) => x.map((t) => t.content))).toEqual([["a", "b"], ["c"], []]);
  });

  it("puts a turn after the last log entry under the current step", () => {
    const b = groupTurns([turn("assistant", "late", 900)], log, 3);
    expect(b[2].map((t) => t.content)).toEqual(["late"]);
  });

  it("clamps a tag beyond the known steps", () => {
    const b = groupTurns([turn("assistant", "x", 1, { step: 9 })], log, 3);
    expect(b[2]).toHaveLength(1);
  });
});

describe("buildPhaseView", () => {
  const stages = ["Get to the VPN settings", "Add the connection", "Test it"];
  const base = input({
    stages,
    stageIndex: 1,
    stepLog: [
      { text: "Open Settings", at: 100, stage: stages[0] },
      { text: "Open Network", at: 200, stage: stages[0] },
      { text: "Click VPN", at: 300, stage: stages[1] },
    ],
    currentInstruction: "Click Add VPN at the top right.",
    upcomingSteps: ["Paste the server", "Save"],
    conversation: [
      turn("user", "Goal: Set up the work VPN", 10, { stage: 0, step: 1 }),
      turn("assistant", "Open Settings.", 20, { stage: 0, step: 1 }),
      turn("assistant", "Click VPN.", 250, { stage: 1, step: 3 }),
      turn("user", "which one?", 310, { stage: 1, step: 4 }),
      turn("assistant", "Click Add VPN at the top right.", 305, { stage: 1, step: 4 }),
      turn("assistant", "Add VPN. Advanced comes later.", 320, { stage: 1, step: 4 }),
    ],
  });

  it("builds phases, steps and states", () => {
    const v = buildPhaseView(base, { currentTitle: "Click Add VPN" });
    expect(v.layout).toBe("phased");
    expect(v.phases.map((p) => p.state)).toEqual(["done", "current", "upcoming"]);
    expect(v.currentPhase).toBe(1);
    expect(v.currentStep).toBe(4);
    expect(v.phases[0].steps.map((s) => s.n)).toEqual([1, 2]);
    expect(v.phases[1].steps.map((s) => [s.n, s.state])).toEqual([
      [3, "done"],
      [4, "current"],
      [5, "upcoming"],
      [6, "upcoming"],
    ]);
    expect(v.phases[2].steps).toEqual([]);
    expect(v.stepInPhase).toEqual({ k: 2, K: 4 });
  });

  it("gives the current step the one lead line", () => {
    const v = buildPhaseView(base, { currentTitle: "Click Add VPN" });
    const holders = v.phases.flatMap((p) => p.steps).filter((s) => s.isLeadHolder);
    expect(holders).toHaveLength(1);
    const cur = holders[0];
    expect(cur.title).toBe("Click Add VPN");
    expect(cur.turns.map((t) => t.content)).toEqual([
      "which one?",
      "Click Add VPN at the top right.",
      "Add VPN. Advanced comes later.",
    ]);
    expect(cur.leadIndex).toBe(1);
  });

  it("marks added steps", () => {
    const v = buildPhaseView(base, { addedSteps: new Set(["paste the server"]) });
    const up = v.phases[1].steps.find((s) => s.n === 5)!;
    expect(up.added).toBe(true);
  });

  it("when done, every phase is done and currentPhase is phases.length", () => {
    const v = buildPhaseView({ ...base, done: true, currentInstruction: "" });
    expect(v.currentPhase).toBe(v.phases.length);
    expect(v.phases.every((p) => p.state === "done")).toBe(true);
    expect(v.phases.flatMap((p) => p.steps).some((s) => s.state !== "done")).toBe(false);
  });

  it("single: one untitled phase holding the steps", () => {
    const v = buildPhaseView(
      input({
        stepLog: [{ text: "Opened Excel", at: 1 }],
        currentInstruction: "Click View.",
        upcomingSteps: ["Freeze panes"],
      }),
    );
    expect(v.layout).toBe("single");
    expect(v.phases).toHaveLength(1);
    expect(v.phases[0].title).toBe("");
    expect(v.stepInPhase).toEqual({ k: 2, K: 3 });
  });

  it("quick: one phase, the answer under step 1", () => {
    const v = buildPhaseView(
      input({
        currentInstruction: "Use View, then Freeze Panes.",
        conversation: [
          turn("user", "How do I freeze the top row?", 1, { step: 1 }),
          turn("assistant", "Use View, then Freeze Panes.", 2, { step: 1 }),
        ],
      }),
    );
    expect(v.layout).toBe("quick");
    expect(v.phases[0].steps[0].turns).toHaveLength(2);
    expect(v.phases[0].steps[0].leadIndex).toBe(1);
  });

  it("places an old chat's untagged turns by time", () => {
    const v = buildPhaseView({
      ...base,
      conversation: base.conversation.map(({ stage, step, ...t }) => t),
    });
    const s1 = v.phases[0].steps[0];
    expect(s1.turns.map((t) => t.content)).toEqual(["Goal: Set up the work VPN", "Open Settings."]);
    const s3 = v.phases[1].steps[0];
    expect(s3.turns.map((t) => t.content)).toEqual(["Click VPN."]);
  });
});

describe("appendTurn tagging and order (DATA §5)", () => {
  beforeEach(() => useSession.getState().reset());

  it("tags a turn with the stage and the step in progress", () => {
    useSession.getState().appendTurn({ role: "user", content: "Goal: x", timestamp: 1 });
    const t = useSession.getState().conversation[0];
    expect(t.stage).toBe(0);
    expect(t.step).toBe(1);
  });

  it("a coach turn that completes a step is tagged with the new step", () => {
    const s = useSession.getState();
    s.applyStages(["One", "Two"], 1);
    // The loop's order: finished steps, then the stage change, then the turn.
    s.applyCompletedSteps(["Did the first thing"], 10);
    s.applyStages(null, 2);
    s.appendTurn({ role: "assistant", content: "Now the second thing.", timestamp: 11 });
    const t = useSession.getState().conversation.at(-1)!;
    expect(t.step).toBe(2);
    expect(t.stage).toBe(1);
    // The finished step stays in the stage it was done in.
    expect(useSession.getState().stepLog[0].stage).toBe("One");
  });

  it("keeps tags a caller already set", () => {
    useSession.getState().appendTurn({ role: "user", content: "x", timestamp: 1, stage: 2, step: 7 });
    const t = useSession.getState().conversation[0];
    expect([t.stage, t.step]).toEqual([2, 7]);
  });

  it("the loop applies steps and stages before appending the coach's turn", async () => {
    const src = (await import("../hooks/useSessionLoop?raw")) as unknown as { default: string };
    const code = src.default;
    const steps = code.indexOf(".applyCompletedSteps(");
    const stages = code.indexOf(".applyStages(");
    const firstAppend = code.indexOf(".appendTurn(");
    expect(steps).toBeGreaterThan(0);
    expect(stages).toBeGreaterThan(steps);
    expect(firstAppend).toBeGreaterThan(stages);
  });
});
