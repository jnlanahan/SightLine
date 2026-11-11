// Auto-scroll rules (redesign SPEC §6.2, §6.7; D6): follow only a reader who
// is already at the bottom; otherwise show the ready pill and stay put.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  decideFollow,
  isAtBottom,
  stepScrollTop,
  useFollowCurrent,
  type FollowCurrent,
  type FollowSnapshot,
} from "../hooks/useFollowCurrent";
import { buildPhaseView, type PhaseInput, type PhaseView } from "../lib/phaseView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snap = (over: Partial<FollowSnapshot> = {}): FollowSnapshot => ({
  currentPhase: 0,
  currentStep: 3,
  done: false,
  layout: "phased",
  ...over,
});

describe("decideFollow", () => {
  it("a finished step at the bottom scrolls", () => {
    expect(decideFollow(snap(), snap({ currentStep: 4 }), true)).toEqual({ kind: "scroll", target: { type: "step", n: 4 } });
  });
  it("a finished step while scrolled up shows the pill", () => {
    expect(decideFollow(snap(), snap({ currentStep: 4 }), false)).toEqual({
      kind: "pill",
      label: "Step 4 is ready",
      target: { type: "step", n: 4 },
    });
  });
  it("a finished phase names the phase", () => {
    expect(decideFollow(snap(), snap({ currentPhase: 1, currentStep: 4 }), false)).toMatchObject({
      kind: "pill",
      label: "Phase 2 is ready",
    });
  });
  it("the goal reached says All done", () => {
    expect(decideFollow(snap(), snap({ done: true, currentPhase: 3 }), false)).toMatchObject({ label: "All done" });
  });
  it("nothing moving on does nothing", () => {
    expect(decideFollow(snap(), snap(), true)).toEqual({ kind: "none" });
    expect(decideFollow(snap(), snap(), false)).toEqual({ kind: "none" });
  });
  it("a quick answer never scrolls", () => {
    expect(decideFollow(snap({ layout: "quick" }), snap({ layout: "quick", currentStep: 4 }), true)).toEqual({ kind: "none" });
  });
});

describe("geometry", () => {
  it("at bottom means within 60 px", () => {
    expect(isAtBottom({ scrollTop: 440, clientHeight: 500, scrollHeight: 1000 })).toBe(true);
    expect(isAtBottom({ scrollTop: 439, clientHeight: 500, scrollHeight: 1000 })).toBe(false);
  });
  it("a new step moves the view only when it would sit within 140 px of the bottom", () => {
    expect(stepScrollTop(100, 500, 200)).toBeNull();
    expect(stepScrollTop(100, 500, 400)).toBe(100 + 400 - 16);
  });
});

// ── The hook, in jsdom ──

function input(over: Partial<PhaseInput>): PhaseInput {
  return {
    stages: ["One", "Two", "Three"],
    stageIndex: 0,
    stepLog: [{ text: "a", at: 1, stage: "One" }, { text: "b", at: 2, stage: "One" }],
    currentInstruction: "Do c.",
    upcomingSteps: ["d"],
    conversation: [],
    done: false,
    ...over,
  };
}

let api: FollowCurrent;
let root: Root;
let host: HTMLDivElement;
let scroller: HTMLDivElement;
let scrollTo: ReturnType<typeof vi.fn>;
const metrics = { scrollTop: 0, clientHeight: 500, scrollHeight: 2000 };

function Harness({ view, chat }: { view: PhaseView; chat: string }) {
  api = useFollowCurrent(view, chat);
  const steps = view.phases.flatMap((p) => p.steps).filter((s) => s.state !== "upcoming");
  return createElement(
    "div",
    { ref: api.scrollRef, onScroll: api.onScroll, "data-testid": "scroller" },
    ...view.phases.map((_, i) => createElement("section", { key: `p${i}`, "data-phase": i })),
    ...steps.map((s) => createElement("div", { key: `s${s.n}`, "data-step": s.n })),
    view.done ? createElement("section", { key: "done", "data-phase": view.phases.length }) : null,
  );
}

function render(view: PhaseView, chat = "chat_a") {
  act(() => root.render(createElement(Harness, { view, chat })));
  scroller = host.querySelector('[data-testid="scroller"]') as HTMLDivElement;
}

function scrollBy(user: number) {
  metrics.scrollTop = user;
  act(() => {
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

beforeEach(() => {
  metrics.scrollTop = 1500; // at the bottom
  scrollTo = vi.fn();
  for (const k of ["scrollTop", "clientHeight", "scrollHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, k, {
      configurable: true,
      get() {
        return this.getAttribute?.("data-testid") === "scroller" ? metrics[k] : 0;
      },
      set(v: number) {
        if (k === "scrollTop") metrics.scrollTop = v;
      },
    });
  }
  (HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
  // Every target sits low in the viewport, so a step near the bottom moves.
  HTMLElement.prototype.getBoundingClientRect = function () {
    const top = this.getAttribute("data-testid") === "scroller" ? 0 : 450;
    return { top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: top, toJSON() {} } as DOMRect;
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useFollowCurrent", () => {
  it("at the bottom: a finished step scrolls, and no pill", () => {
    render(buildPhaseView(input({})));
    scrollTo.mockClear();
    render(buildPhaseView(input({ stepLog: [...input({}).stepLog, { text: "c", at: 3, stage: "One" }] })));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(api.pill).toBeNull();
  });

  it("scrolled up: a finished step shows the pill and does not scroll", () => {
    render(buildPhaseView(input({})));
    scrollBy(200);
    scrollTo.mockClear();
    render(buildPhaseView(input({ stepLog: [...input({}).stepLog, { text: "c", at: 3, stage: "One" }] })));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(api.pill).toBe("Step 4 is ready");
  });

  it("reaching the bottom by hand clears the pill", () => {
    render(buildPhaseView(input({})));
    scrollBy(200);
    render(buildPhaseView(input({ stepLog: [...input({}).stepLog, { text: "c", at: 3, stage: "One" }] })));
    expect(api.pill).not.toBeNull();
    scrollBy(1500);
    expect(api.pill).toBeNull();
  });

  it("tapping the pill scrolls to the new place and clears it", () => {
    render(buildPhaseView(input({})));
    scrollBy(200);
    render(buildPhaseView(input({ stageIndex: 1, stepLog: [...input({}).stepLog, { text: "c", at: 3, stage: "One" }] })));
    expect(api.pill).toBe("Phase 2 is ready");
    scrollTo.mockClear();
    act(() => api.onPillClick());
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(api.pill).toBeNull();
  });

  it("speech or a silent look never scrolls", () => {
    render(buildPhaseView(input({})));
    scrollTo.mockClear();
    // The coach said something (a reply, a streamed line) and a wait turn
    // changed nothing about where the chat stands.
    render(buildPhaseView(input({ currentInstruction: "Do c — the blue button.", conversation: [{ role: "assistant", content: "Still here.", timestamp: 5 }] })));
    render(buildPhaseView(input({ currentInstruction: "Do c — the blue button.", conversation: [{ role: "assistant", content: "Still here.", timestamp: 5 }] })));
    expect(scrollTo).not.toHaveBeenCalled();
    scrollBy(200);
    render(buildPhaseView(input({ upcomingSteps: ["d", "e"] })));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(api.pill).toBeNull();
  });

  it("opening a different chat lands on the current phase without animation", () => {
    render(buildPhaseView(input({})), "chat_a");
    scrollTo.mockClear();
    render(buildPhaseView(input({ stageIndex: 1 })), "chat_b");
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    expect(api.pill).toBeNull();
  });

  it("the rail can scroll to a phase", () => {
    render(buildPhaseView(input({ stageIndex: 1 })));
    scrollTo.mockClear();
    act(() => api.scrollToPhase(0));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
