// The pointer box on the real screen. From the second live run (11 November
// 2026): "a really big box for a small little thing… I'd rather the box fit
// tightly", and a box for a taskbar icon that could not be seen.

import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_MIN_SIDE_PX,
  HIGHLIGHT_PAD_PX,
  highlightRect,
} from "../../electron/highlight-geometry";
import { pointingSkill } from "../../electron/agents/skills/pointing";

// The owner's setup in that run: a 1920x1080 display, the sidebar docked on
// the left taking 400, so the coach sees (and the glow window covers) the
// remaining 1520x1080.
const captured = { x: 400, y: 0, width: 1520, height: 1080 };
const windowAt = { x: 400, y: 0 };
const windowSize = { width: 1520, height: 1080 };

describe("the pointer box", () => {
  it("fits the control, with a few pixels to spare and no more", () => {
    // The "New Variable" button from the run: the coach's box was 137x32 and
    // the app drew 175x70 around it.
    const r = highlightRect({ x: 0.87, y: 0.4, w: 0.09, h: 0.03 }, captured, windowAt, windowSize);
    expect(r.width).toBe(Math.round(0.09 * 1520) + HIGHLIGHT_PAD_PX * 2);
    expect(r.height).toBe(Math.round(0.03 * 1080) + HIGHLIGHT_PAD_PX * 2);
    expect(r.height).toBeLessThan(50);
    expect(HIGHLIGHT_PAD_PX).toBeLessThanOrEqual(8);
  });

  it("is centred on what the coach pointed at", () => {
    const r = highlightRect({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, captured, windowAt, windowSize);
    expect(r.x + r.width / 2).toBeCloseTo(0.55 * 1520, 0);
    expect(r.y + r.height / 2).toBeCloseTo(0.55 * 1080, 0);
  });

  it("is never too small to spot", () => {
    const r = highlightRect({ x: 0.5, y: 0.5, w: 0.002, h: 0.002 }, captured, windowAt, windowSize);
    expect(r.width).toBe(HIGHLIGHT_MIN_SIDE_PX);
    expect(r.height).toBe(HIGHLIGHT_MIN_SIDE_PX);
  });

  it("stays whole on screen for a target at the very edge, like a taskbar icon", () => {
    // The Claude icon on the taskbar from the run: the old box ran from 1021
    // to 1099 on a display 1080 tall.
    const r = highlightRect({ x: 0.49, y: 0.96, w: 0.02, h: 0.04 }, captured, windowAt, windowSize);
    expect(r.y + r.height).toBeLessThanOrEqual(1080);
    expect(r.y).toBeGreaterThan(1080 - 80);
    const corner = highlightRect({ x: 0, y: 0, w: 0.01, h: 0.01 }, captured, windowAt, windowSize);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
  });

  it("maps through a watched area that is only part of the display", () => {
    const region = { x: 600, y: 200, width: 800, height: 500 };
    const r = highlightRect({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, region, windowAt, windowSize);
    expect(r.x + r.width / 2).toBeCloseTo(600 + 0.55 * 800 - 400, 0);
    expect(r.y + r.height / 2).toBeCloseTo(200 + 0.55 * 500, 0);
  });

  it("is brought back above the taskbar before it shows", async () => {
    const main = (await import("../../electron/main?raw")) as unknown as { default: string };
    const flash = main.default.slice(main.default.indexOf('"overlay:flash-highlight"'));
    expect(flash.indexOf("glowWindow.moveTop()")).toBeGreaterThan(0);
    expect(flash.indexOf("glowWindow.moveTop()")).toBeLessThan(flash.indexOf('send("glow:flash"'));
  });

  it("the coach is asked for a close fit, not a generous one", () => {
    const prompt = pointingSkill.systemFragment ?? "";
    expect(prompt).toContain("Fit the box closely to the control itself");
    expect(prompt).not.toContain("a bigger box lands reliably");
  });
});
