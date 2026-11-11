// Coach states on the phase-chat screen (redesign SPEC §7, plan items 1, 5, 6).

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildPhaseView,
  coachState,
  needsYouOf,
  NEEDS_YOU_ACTION_LABEL,
  type CoachStateInput,
} from "../lib/phaseView";
import { STEP_DONE_REPLY, STUCK_REPLY } from "../lib/quickReplies";
import { PhaseRail } from "../components/PhaseRail";
import { NeedsYouBanner } from "../components/phase/NeedsYouBanner";
import { SightLineTheme } from "../design/ThemeProvider";

const base: CoachStateInput = {
  status: "watching",
  activeTool: null,
  newest: { role: "assistant", content: "Click Add VPN." },
  goalPending: false,
  done: false,
  listening: false,
  troubleshooting: false,
  needsYou: false,
  stepDoneReply: STEP_DONE_REPLY,
};
const st = (over: Partial<CoachStateInput>) => coachState({ ...base, ...over });

describe("coachState", () => {
  it("watching", () => {
    expect(st({})).toEqual({ word: "Watching", statusRow: null, halo: "breathing" });
  });
  it("a routine look still says Watching and does not promise speech", () => {
    expect(st({ status: "thinking" })).toEqual({ word: "Watching", statusRow: null, halo: "breathing" });
  });
  it("looking after the user asked", () => {
    expect(st({ status: "thinking", newest: { role: "user", content: "which one?" } })).toEqual({
      word: "Looking",
      statusRow: "Looking at your screen",
      halo: "breathing",
    });
    expect(st({ status: "thinking", newest: { role: "user", content: STUCK_REPLY } }).statusRow).toBe("Looking at your screen");
  });
  it("after I did it: Checking", () => {
    expect(st({ status: "thinking", newest: { role: "user", content: STEP_DONE_REPLY } })).toEqual({
      word: "Checking",
      statusRow: "Checking your screen",
      halo: "breathing",
    });
  });
  it("tools", () => {
    expect(st({ status: "thinking", activeTool: "read_screen_region" }).statusRow).toBe("Taking a closer look");
    expect(st({ status: "thinking", activeTool: "search_web" }).word).toBe("Looking that up");
    expect(st({ status: "thinking", activeTool: "search_memory" }).statusRow).toBe("Checking earlier chats");
  });
  it("listening", () => {
    expect(st({ listening: true }).word).toBe("Listening");
  });
  it("paused: halo off", () => {
    expect(st({ status: "paused" })).toEqual({ word: "Paused", statusRow: null, halo: "off" });
  });
  it("needs you: halo off", () => {
    expect(st({ needsYou: true })).toEqual({ word: "Needs you", statusRow: null, halo: "off" });
  });
  it("done: no halo", () => {
    expect(st({ done: true, status: "waiting" })).toEqual({ word: "Done", statusRow: null, halo: "none" });
  });
  it("waiting on the goal: halo off, because the coach is not looking", () => {
    expect(st({ goalPending: true })).toEqual({ word: "Waiting for you", statusRow: null, halo: "off" });
    // Once they answer, it is looking because they asked.
    expect(st({ goalPending: true, status: "thinking", newest: { role: "user", content: "Yes" } }).word).toBe("Looking");
  });
  it("fixing a problem", () => {
    expect(st({ troubleshooting: true }).word).toBe("Fixing a problem");
  });
});

describe("needsYouOf", () => {
  const n = (over: Partial<Parameters<typeof needsYouOf>[0]>) =>
    needsYouOf({ status: "watching", error: null, hasKey: true, capReached: false, rateLimitSeconds: null, ...over });

  it("nothing wrong", () => {
    expect(n({})).toBeNull();
  });
  it("no key: says where it goes, and opens Settings", () => {
    const r = n({ hasKey: false })!;
    expect(r.message).toContain("No AI key yet. Add one to start.");
    expect(r.action).toBe("key");
    expect(NEEDS_YOU_ACTION_LABEL[r.action!]).toBe("Add a key");
  });
  it("cap reached", () => {
    expect(n({ capReached: true, status: "paused", error: "Session budget reached ($3.00)." })).toEqual({
      message: "You've reached your spending cap for this sitting.",
      action: "cap",
    });
  });
  it("rate limited: the countdown", () => {
    expect(n({ rateLimitSeconds: 12, error: "Rate limited. Backing off for 30s." })!.message).toBe(
      "The AI service asked us to wait. Trying again in 12s.",
    );
  });
  it("the screen cannot be seen", () => {
    expect(n({ status: "error", error: "Capture failed: no source" })).toMatchObject({
      message: "I can't see the screen you picked.",
      action: "screen",
    });
  });
  it("other failures in plain words, the raw error kept as detail", () => {
    expect(n({ error: "TypeError: x is undefined" })).toEqual({
      message: "Something went wrong.",
      action: "retry",
      detail: "TypeError: x is undefined",
    });
    expect(n({ error: "Request failed", rateLimitSeconds: 7 })!.message).toBe("Something went wrong. Trying again in 7s.");
  });
  it("never shows technical words", () => {
    const all = [
      n({ hasKey: false }),
      n({ capReached: true }),
      n({ rateLimitSeconds: 3 }),
      n({ status: "error", error: "Capture failed" }),
      n({ error: "boom" }),
    ].map((r) => r!.message.toLowerCase());
    for (const m of all) for (const w of ["session", "capture", "tokens", "stance", "stage"]) expect(m).not.toContain(w);
  });
});

describe("rendering the states", () => {
  const view = buildPhaseView({
    stages: [],
    stageIndex: 0,
    stepLog: [{ text: "a", at: 1 }],
    currentInstruction: "Do b.",
    upcomingSteps: ["c"],
    conversation: [],
    done: false,
  });
  const rail = (over: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(SightLineTheme, {
        children: createElement(PhaseRail, {
          view,
          collapsed: false,
          muted: false,
          paused: false,
          onAllChats: () => {},
          onPhase: () => {},
          onStep: () => {},
          onMute: () => {},
          onPause: () => {},
          onCollapse: () => {},
          ...over,
        }),
      }),
    );

  it("the halo is off while the goal waits", () => {
    expect(rail({})).toContain("sl-halo");
    expect(rail({ haloOff: true })).not.toContain("sl-halo");
  });

  it("the needs-you banner: plain words, one action, the detail only as a tooltip", () => {
    const h = renderToStaticMarkup(
      createElement(SightLineTheme, {
        children: createElement(NeedsYouBanner, {
          message: "Something went wrong.",
          detail: "TypeError: boom",
          action: { label: "Try again", onClick: () => {} },
        }),
      }),
    );
    expect(h).toContain('role="alert"');
    expect(h).toContain(">Something went wrong.<");
    expect(h).toContain('title="TypeError: boom"');
    expect(h).toContain(">Try again<");
  });

  it("App captures the time away when a chat opens, for the divider", async () => {
    const src = ((await import("../App?raw")) as unknown as { default: string }).default;
    expect(src).toContain("resumeDividerText((now - record.lastActiveAt) / 60_000)");
    expect(src).toContain("resume={resumeDivider}");
  });
});
