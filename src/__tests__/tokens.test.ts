import { describe, it, expect } from "vitest";
import { PALETTES, type Palette, type PaletteName } from "../design/tokens";

// SPEC §11: every token pair used for text meets 4.5:1, in every palette.

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ["ink", "bg"],
  ["ink", "card"],
  ["ink2", "bg"],
  ["ink2", "card"],
  ["ink2", "rail"],
  ["onAccent", "accent"],
  ["doneInk", "doneFill"],
  ["ink", "you"],
  ["btnInk", "btn"],
  ["ink", "input"],
  ["ink", "code"],
];

describe("palette contrast", () => {
  it("has the three palettes", () => {
    expect(Object.keys(PALETTES).sort()).toEqual(["graphite", "midnight", "porcelain"]);
  });

  for (const name of Object.keys(PALETTES) as PaletteName[]) {
    const p = PALETTES[name];
    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${name}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrast(p[fg] as string, p[bg] as string)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("the contrast helper matches known values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});
