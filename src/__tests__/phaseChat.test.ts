// The phase chat renders the view model (redesign SPEC §4, §5, §6.6). Static
// markup checks structure and wording; the look is for the owner's live run.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseChat, type PhaseChatProps } from "../components/phase/PhaseChat";
import { SightLineTheme } from "../design/ThemeProvider";
import {
  buildPhaseView,
  completionHeadline,
  resumeDividerText,
  type PhaseInput,
} from "../lib/phaseView";
import type { ConversationTurn } from "../../electron/types";

const turn = (role: ConversationTurn["role"], content: string, timestamp: number, step?: number, code?: string): ConversationTurn => ({
  role,
  content,
  timestamp,
  ...(step ? { step } : {}),
  ...(code ? { code } : {}),
});

function render(input: Partial<PhaseInput>, over: Partial<PhaseChatProps> = {}, title = "Click Add VPN") {
  const full: PhaseInput = {
    stages: [],
    stageIndex: 0,
    stepLog: [],
    currentInstruction: "",
    upcomingSteps: [],
    conversation: [],
    done: false,
    ...input,
  };
  const view = buildPhaseView(full, { currentTitle: title, addedSteps: new Set(["paste the server"]) });
  const props: PhaseChatProps = {
    view,
    stateWord: "Watching",
    currentInstruction: full.currentInstruction,
    ...over,
  };
  return renderToStaticMarkup(createElement(SightLineTheme, { children: createElement(PhaseChat, props) }));
}

const count = (html: string, s: string) => html.split(s).length - 1;

const stages = ["Get to the VPN settings", "Add the connection", "Test it"];
const phased: Partial<PhaseInput> = {
  stages,
  stageIndex: 1,
  stepLog: [
    { text: "Open Settings", at: 100, stage: stages[0] },
    { text: "Click VPN", at: 300, stage: stages[1] },
  ],
  currentInstruction: "Click Add VPN at the top right.",
  upcomingSteps: ["Paste the server"],
  conversation: [
    turn("user", "Goal: Set up the work VPN", 10, 1),
    turn("assistant", "Open Settings from the start menu.", 20, 1),
    turn("assistant", "Now click VPN.", 150, 2),
    turn("assistant", "Click Add VPN at the top right.", 305, 3, "vpn.northwind.example"),
    turn("user", "which one?", 310, 3),
    turn("assistant", "Add VPN. Advanced comes later.", 320, 3),
  ],
};

describe("phase chat", () => {
  it("renders past and current phases, never upcoming ones", () => {
    const html = render(phased);
    expect(html).toContain("Phase 1 of 3");
    expect(html).toContain("Phase 2 of 3");
    expect(html).not.toContain("Phase 3 of 3");
    expect(html).not.toContain("Test it");
    expect(html).toContain('data-phase="0"');
    expect(html).toContain('data-phase="1"');
  });

  it("puts messages under their steps, numbered across the chat", () => {
    const html = render(phased);
    expect(html).toContain("Step 1 · Open Settings");
    expect(html).toContain("Step 2 · Click VPN");
    expect(html).toContain("Step 3 · Click Add VPN");
    expect(html.indexOf("Now click VPN.")).toBeLessThan(html.indexOf("Step 3 · Click Add VPN"));
    expect(html.indexOf("which one?")).toBeGreaterThan(html.indexOf("Step 3 · Click Add VPN"));
  });

  it("shows exactly one lead line: the current instruction, with its code", () => {
    const html = render(phased);
    expect(count(html, "data-lead-line")).toBe(1);
    expect(count(html, "Click Add VPN at the top right.")).toBe(1);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("vpn.northwind.example");
    expect(html).toContain(">Copy<");
  });

  it("still shows the lead line when no transcript turn matches it", () => {
    const html = render({ ...phased, conversation: [] });
    expect(count(html, "data-lead-line")).toBe(1);
  });

  it("hides the goal turn in a plan; the header carries the goal", () => {
    expect(render(phased)).not.toContain("Set up the work VPN");
  });

  it("current step without a planned title reads 'Step n' alone", () => {
    const html = render(phased, {}, "");
    expect(html).toContain(">Step 3<");
  });

  it("shows the state word on the current phase and Done on past ones", () => {
    const html = render(phased, { stateWord: "Checking" });
    expect(html).toContain("Checking");
    expect(html).toContain("Done");
  });

  it("places plan notes and the resume divider under their step, in time order", () => {
    const html = render(phased, {
      notes: [{ text: 'Plan updated: added "Paste the server"', step: 3, at: 315 }],
      resume: { step: 3, at: 308, text: resumeDividerText(2 * 24 * 60) },
    });
    const note = html.indexOf("Plan updated: added");
    const divider = html.indexOf("Picked up where you left off · 2 days ago");
    expect(divider).toBeGreaterThan(html.indexOf("Click Add VPN at the top right."));
    expect(divider).toBeLessThan(html.indexOf("which one?"));
    expect(note).toBeGreaterThan(html.indexOf("which one?"));
    expect(note).toBeLessThan(html.indexOf("Add VPN. Advanced comes later."));
  });

  it("renders the footer and banner slots in the current phase", () => {
    const html = render(phased, {
      footer: createElement("div", null, "FOOTER-SLOT"),
      banner: createElement("div", null, "BANNER-SLOT"),
    });
    expect(count(html, "FOOTER-SLOT")).toBe(1);
    expect(html.indexOf("BANNER-SLOT")).toBeLessThan(html.lastIndexOf("Add the connection"));
    expect(html.indexOf("BANNER-SLOT")).toBeGreaterThan(html.indexOf("Get to the VPN settings"));
  });

  it("goal waiting: the goal at lead size with its done-when line", () => {
    const html = render(
      { currentInstruction: "", conversation: [turn("user", "Goal: set up the VPN", 1, 1)] },
      { pendingGoal: { goal: "Set up the work VPN on this laptop", doneWhen: "it shows Connected" } },
    );
    expect(count(html, "data-lead-line")).toBe(1);
    expect(html).toContain("Set up the work VPN on this laptop");
    expect(html).toContain("Done when: it shows Connected");
  });

  it("goal reached: a completion section after every phase", () => {
    const html = render({
      ...phased,
      done: true,
      currentInstruction: "",
      conversation: [...phased.conversation!, turn("assistant", "You're connected.", 900, 3)],
    });
    expect(html).toContain('aria-label="Goal reached"');
    expect(html).toContain("You&#x27;re connected.");
    expect(html).toContain("This chat stays open. Ask anything about it later and I&#x27;ll pick up from here.");
    expect(html).not.toContain("data-lead-line");
  });

  it("quick: no checkpoints, the question as a bubble and the answer as the lead line", () => {
    const html = render({
      currentInstruction: "Use View, then Freeze Panes.",
      conversation: [
        turn("user", "Goal: How do I freeze the top row?", 1, 1),
        turn("assistant", "Use View, then Freeze Panes.", 2, 1),
      ],
    });
    expect(html).not.toContain("Step 1");
    expect(html).not.toContain("Phase 1");
    expect(html).toContain("How do I freeze the top row?");
    expect(html).not.toContain("Goal:");
    expect(count(html, "data-lead-line")).toBe(1);
  });

  it("uses no technical words", () => {
    const html = render(phased).toLowerCase();
    for (const w of ["session", "capture", "tokens", "stance", "stage"]) {
      expect(html).not.toContain(w);
    }
  });
});

describe("wording helpers", () => {
  it("resume divider times", () => {
    expect(resumeDividerText(0.2)).toBe("Picked up where you left off · 1 minute ago");
    expect(resumeDividerText(5)).toBe("Picked up where you left off · 5 minutes ago");
    expect(resumeDividerText(120)).toBe("Picked up where you left off · 2 hours ago");
    expect(resumeDividerText(3 * 24 * 60)).toBe("Picked up where you left off · 3 days ago");
  });

  it("completion headline", () => {
    expect(completionHeadline("You're connected.")).toBe("You're connected.");
    expect(completionHeadline("x".repeat(60))).toBe("Done.");
    expect(completionHeadline(undefined)).toBe("Done.");
  });
});
