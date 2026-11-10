import { describe, expect, it } from "vitest";
import {
  planProgress,
  toPlanSteps,
  toStepPhrase,
} from "../lib/planSteps";

describe("toStepPhrase", () => {
  it("leaves a short instruction alone", () => {
    expect(toStepPhrase("Click the gear icon.")).toBe("Click the gear icon.");
  });

  it("keeps just the first sentence when that is the action", () => {
    expect(
      toStepPhrase(
        "Click the blue Export button. It'll open a save dialog where you pick a folder.",
      ),
    ).toBe("Click the blue Export button.");
  });

  it("cuts on a word boundary when there is no usable sentence break", () => {
    const phrase = toStepPhrase(
      "Go ahead and open the settings panel and then scroll right down to the very bottom section",
    );
    expect(phrase.length).toBeLessThanOrEqual(73);
    expect(phrase.endsWith("…")).toBe(true);
    expect(phrase).not.toMatch(/\s…$/);
  });

  it("collapses stray whitespace", () => {
    expect(toStepPhrase("Click   the\n gear.")).toBe("Click the gear.");
  });

  it("handles an empty instruction", () => {
    expect(toStepPhrase("")).toBe("");
  });
});

describe("toPlanSteps", () => {
  it("is empty before the coach has said anything", () => {
    expect(
      toPlanSteps({
        completedSteps: [],
        currentInstruction: "",
        upcomingSteps: [],
        done: false,
      }),
    ).toEqual([]);
  });

  it("orders completed, then current, then upcoming", () => {
    const steps = toPlanSteps({
      completedSteps: ["Download the client", "Create an account"],
      currentInstruction: "Now connect to a server.",
      upcomingSteps: ["Verify the connection"],
      done: false,
    });
    expect(steps.map((s) => s.state)).toEqual([
      "completed",
      "completed",
      "current",
      "upcoming",
    ]);
  });

  it("has no current step once the session is finished", () => {
    const steps = toPlanSteps({
      completedSteps: ["Everything"],
      currentInstruction: "Nice work, you're all set.",
      upcomingSteps: [],
      done: true,
    });
    expect(steps.every((s) => s.state === "completed")).toBe(true);
  });

  it("drops an upcoming step the agent already marked complete", () => {
    // The agent sometimes repeats itself; showing a step twice makes the
    // progress count wrong, which reads as a bug.
    const steps = toPlanSteps({
      completedSteps: ["Download the client"],
      currentInstruction: "",
      upcomingSteps: ["Download the client", "Create an account"],
      done: false,
    });
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.description)).toEqual([
      "Download the client",
      "Create an account",
    ]);
  });

  it("dedupes case-insensitively", () => {
    const steps = toPlanSteps({
      completedSteps: ["Download the client"],
      currentInstruction: "",
      upcomingSteps: ["download the CLIENT"],
      done: false,
    });
    expect(steps).toHaveLength(1);
  });

  it("ignores blank entries from the model", () => {
    const steps = toPlanSteps({
      completedSteps: ["", "  ", "Real step"],
      currentInstruction: "   ",
      upcomingSteps: ["", "Another"],
      done: false,
    });
    expect(steps.map((s) => s.description)).toEqual(["Real step", "Another"]);
  });

  it("shortens the current instruction for a plan row", () => {
    const steps = toPlanSteps({
      completedSteps: [],
      currentInstruction:
        "See that blue Export button in the top right corner of the toolbar? Go ahead and click it now.",
      upcomingSteps: [],
      done: false,
    });
    expect(steps[0].description.length).toBeLessThan(80);
  });
});

describe("planProgress", () => {
  it("is 0 with no plan", () => {
    expect(planProgress([])).toBe(0);
  });

  it("is 0 before anything is done", () => {
    expect(
      planProgress([
        { description: "a", state: "current" },
        { description: "b", state: "upcoming" },
      ]),
    ).toBe(0);
  });

  it("reflects the completed share", () => {
    expect(
      planProgress([
        { description: "a", state: "completed" },
        { description: "b", state: "completed" },
        { description: "c", state: "current" },
        { description: "d", state: "upcoming" },
      ]),
    ).toBe(0.5);
  });

  it("is 1 when everything is done", () => {
    expect(
      planProgress([
        { description: "a", state: "completed" },
        { description: "b", state: "completed" },
      ]),
    ).toBe(1);
  });
});
