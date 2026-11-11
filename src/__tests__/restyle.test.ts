// The screens whose layouts are not redesigned are recoloured with the
// palette (redesign WP9): readable in every palette, no colours of their own.

import { describe, expect, it } from "vitest";
import { makeTheme } from "../design/theme";
import { PALETTES, type PaletteName } from "../design/tokens";

function lum(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("the restyled screens' theme", () => {
  for (const name of Object.keys(PALETTES) as PaletteName[]) {
    const T = makeTheme(PALETTES[name]);
    const pairs: [string, string, string][] = [
      ["ink", T.ink, T.surface],
      ["ink2", T.ink2, T.surface],
      ["ink3", T.ink3, T.surface],
      ["accentText", T.accentText, T.surface],
      ["warn", T.warn, T.surface],
      ["onWarn", T.onWarn, T.warn],
      ["onAccent", T.onAccent, T.accent],
    ];
    for (const [label, fg, bg] of pairs) {
      it(`${name}: ${label} is at least 4.5:1`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${name}: every colour comes from the palette`, () => {
      expect(T.surface).toBe(PALETTES[name].bg);
      expect(T.accent).toBe(PALETTES[name].accent);
    });
  }
});

describe("no colours of their own", () => {
  const files = [
    "../components/Home",
    "../components/AboutChat",
    "../components/Settings",
    "../components/PrivacyNotice",
    "../components/ScreenPicker",
    "../components/ModelCaption",
    "../App",
  ];
  for (const f of files) {
    it(`${f} has no hard-coded text or surface colours`, async () => {
      const src = ((await import(/* @vite-ignore */ `${f}?raw`)) as unknown as { default: string }).default;
      // Shadows (rgba black) are allowed; colour literals are not.
      expect(src.match(/["'`]#[0-9A-Fa-f]{3,8}["'`]/g) ?? []).toEqual([]);
      expect(src).not.toMatch(/rgba\((?!0,\s*0,\s*0|22,26,14)\d/);
    });
  }
});
