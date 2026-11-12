import { describe, it, expect, vi } from "vitest";

// settings-store imports Electron's `app` (for the settings path) and the log
// module does too; neither is touched by the pure functions under test.
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/sightline-test" } }));

import { resolveCustomAccent, resolvePalette, LEGACY_ACCENT_TO_PALETTE } from "../../electron/settings-store";
import {
  ACCENT_SWATCHES,
  ACCENT_TO_PALETTE,
  DEFAULT_PALETTE,
  PALETTES,
  accentInkOn,
  contrastRatio,
  isHexColor,
  withAccent,
} from "../design/tokens";
import type { Settings } from "../../electron/types";

describe("palette setting (WP1)", () => {
  // The design made dark Graphite the default; after using it the owner asked
  // for it not to be (second live run, 11 November 2026). Light Porcelain now.
  it("defaults to Porcelain, the light set", () => {
    expect(DEFAULT_PALETTE).toBe("porcelain");
    expect(resolvePalette({})).toBe("porcelain");
    expect(PALETTES[DEFAULT_PALETTE].dark).toBe(false);
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
    expect(resolvePalette(bad)).toBe("porcelain");
  });

  it("the settings default is written as porcelain", async () => {
    const src = await import("../../electron/settings-store?raw");
    const content = (src as unknown as { default: string }).default;
    expect(content).toContain('palette: "porcelain"');
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

// The second live run, 11 November 2026: "I'm still not a fan of the color
// scheme. Maybe we do a custom color… or maybe we keep the themes and we can
// adjust the color within those themes." The colour sets stay; the accent can
// be any colour.
describe("the user's own accent colour", () => {
  it("replaces the colour set's accent, and the outline on the screen follows it", () => {
    const p = withAccent(PALETTES.porcelain, "#3b7ddd");
    expect(p.accent).toBe("#3B7DDD");
    expect(p.glow).toBe("#3B7DDD");
    // Everything else about the set is untouched.
    expect(p.bg).toBe(PALETTES.porcelain.bg);
    expect(p.ink).toBe(PALETTES.porcelain.ink);
  });

  it("text on the accent is readable whatever colour is picked", () => {
    const colours = ["#000000", "#FFFFFF", "#FFEB3B", "#3B7DDD", "#8A63D2", "#7F7F7F", "#D6497F", ...ACCENT_SWATCHES.map((s) => s.hex)];
    for (const c of colours) {
      const p = withAccent(PALETTES.graphite, c);
      expect(contrastRatio(p.accent, p.onAccent), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("accent-coloured words fall back to the ink when the accent would not be readable", () => {
    const pale = withAccent(PALETTES.porcelain, "#FFEB3B");
    expect(accentInkOn(pale)).toBe(PALETTES.porcelain.ink);
    const strong = withAccent(PALETTES.porcelain, "#1F5FBF");
    expect(accentInkOn(strong)).toBe("#1F5FBF");
  });

  it("anything that is not a colour leaves the set as it is", () => {
    for (const bad of [null, undefined, "", "blue", "#12", "#GGGGGG", "javascript:alert(1)"]) {
      expect(withAccent(PALETTES.midnight, bad as string | null)).toBe(PALETTES.midnight);
      expect(resolveCustomAccent(bad)).toBeNull();
    }
    expect(resolveCustomAccent("#3b7ddd")).toBe("#3B7DDD");
    expect(isHexColor("#3B7DDD")).toBe(true);
  });

  it("starts unset, and the main process uses it for the glow when set", async () => {
    const store = ((await import("../../electron/settings-store?raw")) as unknown as { default: string }).default;
    expect(store).toContain("customAccent: null");
    const main = ((await import("../../electron/main?raw")) as unknown as { default: string }).default;
    expect(main).toContain("s.customAccent ?? PALETTE_GLOW[s.palette]");
    expect(main).toContain('"customAccent" in patch');
  });

  it("the ready-made swatches are real colours", () => {
    expect(ACCENT_SWATCHES.length).toBeGreaterThanOrEqual(5);
    for (const s of ACCENT_SWATCHES) expect(isHexColor(s.hex), s.name).toBe(true);
  });
});
