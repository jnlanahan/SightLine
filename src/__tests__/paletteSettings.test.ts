import { describe, it, expect, vi } from "vitest";

// settings-store imports Electron's `app` (for the settings path) and the log
// module does too; neither is touched by the pure functions under test.
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/sightline-test" } }));

import { resolvePalette, LEGACY_ACCENT_TO_PALETTE } from "../../electron/settings-store";
import { ACCENT_TO_PALETTE, PALETTES, DEFAULT_PALETTE } from "../design/tokens";
import type { Settings } from "../../electron/types";

describe("palette setting (WP1)", () => {
  it("defaults to Graphite", () => {
    expect(DEFAULT_PALETTE).toBe("graphite");
    expect(resolvePalette({})).toBe("graphite");
  });

  it("maps every old accent once, exactly as tokens.ts says", () => {
    const accents = ["lime", "cobalt", "rose", "slate"] as const;
    for (const a of accents) {
      expect(resolvePalette({ accentColor: a })).toBe(ACCENT_TO_PALETTE[a]);
    }
    expect(LEGACY_ACCENT_TO_PALETTE).toEqual(ACCENT_TO_PALETTE);
  });

  it("a saved palette wins over an old accent", () => {
    expect(resolvePalette({ palette: "porcelain", accentColor: "cobalt" })).toBe("porcelain");
  });

  it("accentColor is gone from the settings type", async () => {
    const src = ((await import("../../electron/types?raw")) as unknown as { default: string }).default;
    expect(src).not.toContain("accentColor");
    expect(src).not.toContain("AccentName");
  });

  it("ignores garbage values", () => {
    const bad = { palette: "neon", accentColor: "plaid" } as unknown as Partial<Settings>;
    expect(resolvePalette(bad)).toBe("graphite");
  });

  it("the settings default is written as graphite", async () => {
    const src = await import("../../electron/settings-store?raw");
    const content = (src as unknown as { default: string }).default;
    expect(content).toContain('palette: "graphite"');
    expect(content).not.toContain('accentColor: "lime"');
  });

  it("the glow overlay colours mirror each palette's glow token", async () => {
    const src = await import("../../electron/main?raw");
    const content = (src as unknown as { default: string }).default;
    for (const [name, p] of Object.entries(PALETTES)) {
      expect(content).toContain(`${name}: "${p.glow}"`);
    }
  });
});
