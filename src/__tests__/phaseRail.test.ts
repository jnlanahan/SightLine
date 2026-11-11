// The phase rail renders what the view model says (redesign SPEC §3). Static
// markup is enough to check structure, labels and the halo rules; the look
// itself is the owner's to judge in a live run.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseRail, type PhaseRailProps } from "../components/PhaseRail";
import { SightLineTheme } from "../design/ThemeProvider";
import { PALETTES } from "../design/tokens";
import { buildPhaseView, type PhaseInput } from "../lib/phaseView";

const noop = () => {};

function render(input: Partial<PhaseInput>, over: Partial<PhaseRailProps> = {}, palette: "graphite" | "porcelain" | "midnight" = "graphite") {
  const view = buildPhaseView(
    {
      stages: [],
      stageIndex: 0,
      stepLog: [],
      currentInstruction: "",
      upcomingSteps: [],
      conversation: [],
      done: false,
      ...input,
    },
    { addedSteps: new Set(["paste the server"]) },
  );
  const props: PhaseRailProps = {
    view,
    collapsed: false,
    muted: false,
    paused: false,
    onAllChats: noop,
    onPhase: noop,
    onStep: noop,
    onMute: noop,
    onPause: noop,
    onCollapse: noop,
    ...over,
  };
  return renderToStaticMarkup(createElement(SightLineTheme, { palette, children: createElement(PhaseRail, props) }));
}

const stages = ["Get to the VPN settings", "Add the connection", "Test it"];
const phased: Partial<PhaseInput> = {
  stages,
  stageIndex: 1,
  stepLog: [
    { text: "Open Settings", at: 1, stage: stages[0] },
    { text: "Click VPN", at: 2, stage: stages[1] },
  ],
  currentInstruction: "Click Add VPN.",
  upcomingSteps: ["Paste the server"],
};

describe("phase rail", () => {
  it("phased: done, current and upcoming phases with their labels", () => {
    const html = render(phased);
    expect(html).toContain('aria-label="All chats"');
    expect(html).toContain('aria-label="Phase 1, done: Get to the VPN settings"');
    expect(html).toContain('aria-label="Phase 2, current: Add the connection"');
    expect(html).toContain('role="img" aria-label="Phase 3, upcoming: Test it"');
    // Upcoming phases are not interactive and carry a native tooltip.
    expect(html).toContain('title="Test it"');
  });

  it("draws a dot per step under reached phases, with a ring on an added step", () => {
    const html = render(phased);
    // Phase 1: one done dot. Phase 2: done, current, upcoming(added). Phase 3: none.
    const dots = html.match(/width:6px;height:6px/g) ?? [];
    expect(dots).toHaveLength(4);
    expect(html).toContain(`box-shadow:0 0 0 2px ${PALETTES.graphite.rail}, 0 0 0 3.5px ${PALETTES.graphite.accent}`);
  });

  it("breathes behind the current circle while watching", () => {
    expect(render(phased)).toContain('class="sl-halo"');
  });

  it("turns the halo off when paused, when something needs the user, and when done", () => {
    expect(render(phased, { paused: true })).not.toContain("sl-halo");
    expect(render(phased, { needsYou: true })).not.toContain("sl-halo");
    expect(render({ ...phased, done: true, currentInstruction: "" })).not.toContain("sl-halo");
  });

  it("paused: the bottom control offers to resume", () => {
    const html = render(phased, { paused: true });
    expect(html).toContain('aria-label="Resume watching"');
    expect(html).not.toContain('aria-label="Pause watching"');
  });

  it("every bottom control names the action it will take", () => {
    const html = render(phased);
    expect(html).toContain('aria-label="Mute voice"');
    expect(html).toContain('aria-label="Pause watching"');
    expect(html).toContain('aria-label="Collapse to rail"');
    const muted = render(phased, { muted: true, collapsed: true });
    expect(muted).toContain('aria-label="Turn voice on"');
    expect(muted).toContain('aria-label="Expand"');
  });

  it("single: the steps themselves are the circles, with no dots", () => {
    const html = render({
      stepLog: [{ text: "Opened Excel", at: 1 }],
      currentInstruction: "Click View.",
      upcomingSteps: ["Freeze panes"],
    });
    expect(html).toContain('aria-label="Step 1, done: Opened Excel"');
    expect(html).toContain('aria-label="Step 2, current"');
    expect(html).toContain('aria-label="Step 3, upcoming: Freeze panes"');
    expect(html).not.toMatch(/width:6px;height:6px/);
  });

  it("quick: no rail while expanded", () => {
    expect(render({ currentInstruction: "Use View, then Freeze Panes." })).toBe("");
  });

  it("quick, collapsed: one accent circle and the bottom controls", () => {
    const html = render({ currentInstruction: "Use View." }, { collapsed: true, latestLine: "Use View." });
    expect(html).toContain('aria-label="Watching"');
    expect(html).toContain('title="Use View."');
    expect(html).toContain('aria-label="Expand"');
  });

  it("collapsed: the current circle carries the latest coach line", () => {
    const html = render(phased, { collapsed: true, latestLine: "Click Add VPN at the top right." });
    expect(html).toContain('aria-description="Click Add VPN at the top right."');
  });

  it("uses only palette colours, in every palette", () => {
    for (const name of ["graphite", "porcelain", "midnight"] as const) {
      const html = render(phased, {}, name);
      const p = PALETTES[name];
      expect(html).toContain(`background:${p.rail}`);
      const hexes = new Set((html.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) => h.toUpperCase()));
      const allowed = new Set(Object.values(p).filter((v) => typeof v === "string").map((v) => (v as string).toUpperCase()));
      allowed.add("#000000"); // the edge-fade mask, not a colour on screen
      for (const h of hexes) expect(allowed.has(h)).toBe(true);
    }
  });
});
