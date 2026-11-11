// The open chat's header, menu and composer (redesign SPEC §4.1, §4.8, §5;
// plan "The redesign: phase chats" items 3 and 4).

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseHeader, headerStatusLine } from "../components/phase/PhaseHeader";
import { ChatMenu, costLine } from "../components/phase/ChatMenu";
import { Composer } from "../components/Composer";
import { SightLineTheme } from "../design/ThemeProvider";
import { buildPhaseView, type PhaseInput } from "../lib/phaseView";

const noop = () => {};
const wrap = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(SightLineTheme, { children: el }));

function view(over: Partial<PhaseInput>) {
  return buildPhaseView({
    stages: [],
    stageIndex: 0,
    stepLog: [],
    currentInstruction: "",
    upcomingSteps: [],
    conversation: [],
    done: false,
    ...over,
  });
}

const phased = view({
  stages: ["One", "Two", "Three"],
  stageIndex: 1,
  stepLog: [{ text: "a", at: 1, stage: "One" }, { text: "b", at: 2, stage: "Two" }],
  currentInstruction: "Do c.",
  upcomingSteps: ["d", "e"],
});

describe("header status line", () => {
  it("phased: phase, step within the phase, state", () => {
    expect(headerStatusLine(phased, "Watching")).toBe("Phase 2 of 3 · step 2 of 4 · Watching");
  });
  it("single: step k of K", () => {
    expect(headerStatusLine(view({ currentInstruction: "Do it.", upcomingSteps: ["x", "y"] }), "Watching")).toBe(
      "Step 1 of 3 · Watching",
    );
  });
  it("quick: the state word alone", () => {
    expect(headerStatusLine(view({ currentInstruction: "Answer." }), "Watching")).toBe("Watching");
  });
});

describe("header", () => {
  const controls = { muted: false, paused: false, onAllChats: noop, onMute: noop, onPause: noop, onCollapse: noop };

  it("plan: title, status and the menu button only", () => {
    const h = wrap(createElement(PhaseHeader, { title: "Set up the work VPN", view: phased, stateWord: "Watching", menuOpen: false, onMenu: noop, quickControls: controls }));
    expect(h).toContain("Set up the work VPN");
    expect(h).toContain('aria-label="Menu"');
    expect(h).toContain('aria-haspopup="menu"');
    expect(h).not.toContain('aria-label="All chats"');
  });

  it("quick: All chats and the rail's controls move into the header", () => {
    const h = wrap(createElement(PhaseHeader, { title: "Freeze the top row", view: view({ currentInstruction: "x" }), stateWord: "Watching", menuOpen: false, onMenu: noop, quickControls: controls }));
    for (const l of ["All chats", "Mute voice", "Pause watching", "Collapse to rail", "Menu"]) {
      expect(h).toContain(`aria-label="${l}"`);
    }
  });
});

describe("the menu", () => {
  const props = {
    docked: true,
    aboutOpen: false,
    attachedCount: 0,
    canPeek: true,
    onClose: noop,
    onAbout: noop,
    onAttach: noop,
    onPeek: noop,
    onAdjustArea: noop,
    onToggleDock: noop,
    onSettings: noop,
    onMinimize: noop,
    onQuit: noop,
  };

  it("holds everything the old header and bottom bar did", () => {
    const h = wrap(createElement(ChatMenu, props));
    expect(h).toContain('role="menu"');
    for (const l of ["About this chat", "Attach a file", "See what the coach sees", "Float the window", "Settings", "So far this sitting", "Minimize", "Quit"]) {
      expect(h).toContain(l);
    }
    expect(wrap(createElement(ChatMenu, { ...props, docked: false }))).toContain("Dock to the side");
  });

  it("the cost line", () => {
    expect(costLine(0.12, 3)).toBe("So far this sitting: $0.12 of $3.00");
    expect(costLine(0.12, 0)).toBe("So far this sitting: $0.12");
  });

  it("uses no technical words", () => {
    const h = wrap(createElement(ChatMenu, props)).toLowerCase();
    for (const w of ["session", "capture", "tokens", "stance", "stage"]) expect(h).not.toContain(w);
  });
});

describe("composer", () => {
  it("takes the placeholder, has a hidden label and a 44 px hold-to-talk button", () => {
    const h = wrap(createElement(Composer, { placeholder: "Ask about step 3", isThinking: false, onSubmit: noop, onStartTalking: noop, onStopTalking: noop }));
    expect(h).toContain('placeholder="Ask about step 3"');
    expect(h).toContain("Message the coach");
    expect(h).toContain('aria-label="Hold to talk"');
  });

  it("keeps the press-and-hold logic: pointer down opens, any release anywhere closes", async () => {
    const src = ((await import("../components/Composer?raw")) as unknown as { default: string }).default;
    expect(src).toContain('window.addEventListener("pointerup", release);');
    expect(src).toContain('window.addEventListener("pointercancel", release);');
    expect(src).toContain('window.addEventListener("blur", release);');
    expect(src).toMatch(/onPointerDown=\{\(e\) => \{\s*if \(e\.button !== 0\) return;\s*e\.preventDefault\(\);\s*holdingRef\.current = true;\s*onStartTalking\(\);/);
  });
});

describe("the open chat in App", () => {
  it("is the phase-chat screen, and one-tap replies go through submitFollowUp", async () => {
    const src = ((await import("../App?raw")) as unknown as { default: string }).default;
    const view = src.slice(src.indexOf("function openChatView()"), src.indexOf("if (goal) return openChatView();"));
    expect(view).toContain("<PhaseChat");
    expect(view).toContain("<PhaseRail");
    expect(view).toContain("<PhaseHeader");
    expect(view).toContain("<ChatMenu");
    expect(view).toContain("<ReadyPill");
    expect(view).toContain("<ModelCaption");
    expect(view).toContain("onReply={submitFollowUp}");
    expect(view).not.toContain("<Instruction");
    expect(view).not.toContain("<ConversationHistory");
    expect(view).not.toContain("<GoalCard");
    // No scroll-to-newest: only useFollowCurrent moves the view.
    expect(src).not.toContain("scrollIntoView");
  });
});
