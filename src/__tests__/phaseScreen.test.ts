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

// The second live run, 11 November 2026: "the same top menu needs to show no
// matter if you're in a chat or not… the settings button needs to look like a
// settings button… when you go into a chat, the settings go away."
describe("the top bar is the same on every screen", () => {
  const controls = { muted: false, paused: false, onAllChats: noop, onMute: noop, onPause: noop };
  const base = { menuOpen: false, onMenu: noop, onSettings: noop };
  const home = () => wrap(createElement(PhaseHeader, { ...base, title: "SightLine", status: "Ready when you are", statusDot: true }));
  const plan = () => wrap(createElement(PhaseHeader, { ...base, title: "Set up the work VPN", status: headerStatusLine(phased, "Watching") }));
  const quick = () => wrap(createElement(PhaseHeader, { ...base, title: "Freeze the top row", status: "Watching", statusDot: true, quickControls: controls }));

  it("Settings and the menu are on Home, in a plan and in a quick answer", () => {
    for (const h of [home(), plan(), quick()]) {
      expect(h).toContain('aria-label="Settings"');
      expect(h).toContain('aria-label="More options"');
      expect(h).toContain('aria-haspopup="menu"');
      // Always Settings first, then the menu, at the right-hand end.
      expect(h.indexOf('aria-label="Settings"')).toBeLessThan(h.indexOf('aria-label="More options"'));
      expect(h.lastIndexOf("<button")).toBe(h.indexOf('<button', h.indexOf('aria-label="Settings"')));
    }
  });

  it("plan: title and status, and no rail controls", () => {
    const h = plan();
    expect(h).toContain("Set up the work VPN");
    expect(h).toContain("Phase 2 of 3");
    expect(h).not.toContain('aria-label="All chats"');
    expect(h).not.toContain('aria-label="Mute voice"');
  });

  it("quick: All chats, mute and pause sit here, because there is no rail", () => {
    const h = quick();
    for (const l of ["All chats", "Mute voice", "Pause watching"]) {
      expect(h).toContain('aria-label="' + l + '"');
    }
  });

  it("Home uses it too, in place of the old row of eight buttons", async () => {
    const app = (await import("../App?raw")) as unknown as { default: string };
    expect(app.default.split("<PhaseHeader").length - 1).toBe(2);
    expect(app.default.split("<ChatMenu").length - 1).toBe(2);
    expect(app.default).not.toContain("function PanelHeader");
    expect(app.default).not.toContain("IGear");
  });
});

describe("the menu", () => {
  const props = {
    inChat: true,
    docked: true,
    aboutOpen: false,
    attachedCount: 0,
    canPeek: true,
    onClose: noop,
    onAbout: noop,
    onAttach: noop,
    onPeek: noop,
    onCollapse: noop,
    onToggleDock: noop,
    onMinimize: noop,
    onQuit: noop,
  };

  it("in a chat: the chat's own options, then the window's", () => {
    const h = wrap(createElement(ChatMenu, props));
    expect(h).toContain('role="menu"');
    for (const l of ["About this chat", "Attach a file", "See what the coach sees", "So far this sitting", "Collapse", "Float the window", "Minimize", "Quit"]) {
      expect(h).toContain(l);
    }
    expect(h.indexOf("Attach a file")).toBeLessThan(h.indexOf("Minimize"));
    expect(wrap(createElement(ChatMenu, { ...props, docked: false }))).toContain("Dock to the side");
  });

  it("on Home: only the window's options, nothing about a chat", () => {
    const h = wrap(createElement(ChatMenu, { inChat: false, docked: true, onClose: noop, onCollapse: noop, onToggleDock: noop, onMinimize: noop, onQuit: noop }));
    for (const l of ["Collapse", "Float the window", "Minimize", "Quit"]) expect(h).toContain(l);
    for (const l of ["About this chat", "Attach a file", "See what the coach sees", "So far this sitting"]) expect(h).not.toContain(l);
  });

  it("Settings is not buried in it: it has its own button on every screen", () => {
    expect(wrap(createElement(ChatMenu, props))).not.toContain(">Settings<");
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

// "See what the coach sees" opened a picture that could not be closed: the
// panel's window-drag handler took the press before the click arrived.
describe("what the coach sees", () => {
  it("has a Close button and is exempt from window dragging", async () => {
    const app = (await import("../App?raw")) as unknown as { default: string };
    const peek = app.default.slice(app.default.indexOf("function PeekOverlay"), app.default.indexOf("function PanelShell"));
    expect(peek).toContain('className="no-drag ');
    expect(peek).toContain('aria-label="Close"');
    expect(peek).toContain("onClick={onClose}");
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
