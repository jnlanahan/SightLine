// sightline/theme.ts
// Accent palettes + theme tokens for the SightLine overlay components.

// The theme shape the screens without a redesigned layout read (Home, About
// this chat, Settings, the privacy notice, the screen picker, the floating
// bar, Home's header). Redesign WP9: every value now comes from the active
// palette (src/design/tokens.ts), so those screens recolour with it while
// keeping their layouts. New components read the palette directly
// (`useTokens()`).

import { accentInkOn, font as tokenFont, type Palette } from "./tokens";

export interface SightLineTheme {
  surface: string;
  glassBg: string;
  glassGrad: string;
  border: string;
  hi: string;
  ink: string;
  ink2: string;
  /** Tertiary text. Same as ink2: the palettes have no third text colour
   *  that meets 4.5:1. */
  ink3: string;
  instr: string;
  green: string;
  greenRGB: string;
  logoInk: string;
  font: string;
  display: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  /** Accent-coloured text on the panel surface. */
  accentText: string;
  gold: string;
  accentRGB: string;
  onAccent: string;
  logoGrad: string;
  /** Destructive and warning states (delete, muted, failures). */
  warn: string;
  warnSoft: string;
  /** Text on a solid `warn` button. */
  onWarn: string;
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// The active palette's ink, for `lt()`. Set by makeTheme, which the theme
// provider calls whenever the palette changes; there is one theme per window.
let inkRGB = "236,237,232";

/** A hairline or tint in the active palette's ink, at the given alpha. */
export const lt = (a: number) => `rgba(${inkRGB},${a})`;
/** accent rgb at a given alpha */
export const ar = (rgb: string, a: number) => `rgba(${rgb},${a})`;

export function makeTheme(p: Palette): SightLineTheme {
  const rgb = hexToRgb(p.accent);
  inkRGB = hexToRgb(p.ink);
  return {
    surface: p.bg,
    glassBg: p.bg,
    glassGrad: `linear-gradient(${p.bg}, ${p.bg})`,
    border: p.line,
    hi: p.line,
    ink: p.ink,
    ink2: p.ink2,
    ink3: p.ink2,
    instr: p.card,
    green: p.accent,
    greenRGB: rgb,
    logoInk: p.ink,
    // Manrope (bundled), with Segoe UI behind it. The old Didot display face
    // is retired (redesign D12).
    font: tokenFont.sans,
    display: tokenFont.sans,
    accent: p.accent,
    accentDeep: p.accent,
    accentSoft: `rgba(${rgb},0.6)`,
    // Readable as words on the panel whatever accent the user picked.
    accentText: accentInkOn(p),
    gold: p.accent,
    accentRGB: rgb,
    onAccent: p.onAccent,
    logoGrad: `linear-gradient(150deg, ${p.accent} 0%, ${p.accent} 100%)`,
    warn: p.warn,
    warnSoft: p.warnSoft,
    onWarn: p.dark ? p.rail : p.card,
  };
}
