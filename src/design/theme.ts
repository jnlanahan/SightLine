// sightline/theme.ts
// Accent palettes + theme tokens for the SightLine overlay components.

// The pre-redesign theme shape. Screens whose layouts are not redesigned yet
// (Home, About this chat, Settings, the privacy notice, the screen picker,
// the floating bar) still read it; its accent now comes from the active
// palette (src/design/tokens.ts), so the four-accent system is gone. New
// components read the palette directly (`useTokens()`).

import { font as tokenFont, type Palette } from "./tokens";

export interface SightLineTheme {
  // Solid panel surface — warm porcelain so the panel reads as a bright
  // physical card against any (usually darker, busy) desktop behind it.
  surface: string;
  glassBg: string;
  glassGrad: string;
  border: string;
  hi: string;
  ink: string;
  ink2: string;
  ink3: string;
  instr: string;
  green: string;
  greenRGB: string;
  logoInk: string;
  font: string;
  // Characterful serif — reserved for the wordmark and the coach's spoken
  // instruction. Everything else stays in the quiet sans.
  display: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  accentText: string;
  gold: string;
  accentRGB: string;
  onAccent: string;
  logoGrad: string;
}

/** ink-on-porcelain hairline / tint at a given alpha */
export const lt = (a: number) => `rgba(44,48,34,${a})`;
/** accent rgb at a given alpha */
export const ar = (rgb: string, a: number) => `rgba(${rgb},${a})`;

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function makeTheme(p: Palette): SightLineTheme {
  const rgb = hexToRgb(p.accent);
  return {
    // A notch below white on purpose: docked beside a white web page or
    // document, a near-white panel read as part of the page. Still porcelain,
    // just with an edge.
    surface: "#ECE9DF",
    glassBg: "rgba(236,233,223,0.86)",
    glassGrad: "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(236,233,223,0.35) 100%)",
    border: lt(0.22), hi: "rgba(255,255,255,0.8)",
    ink: "#23271C", ink2: "#4C5243", ink3: "#7B816D",
    // The instruction card stays deep ink — the coach's voice is the one
    // dark object on the light panel, so it's always the first thing read.
    instr: "linear-gradient(180deg, #262B1E 0%, #15180F 100%)",
    green: "#4F8A2C", greenRGB: "110,167,66", logoInk: "#0e1118",
    // Manrope (bundled), with Segoe UI behind it — the redesign's face. The
    // old Didot display face is retired (redesign D12).
    font: tokenFont.sans,
    display: tokenFont.sans,
    accent: p.accent,
    accentDeep: p.accent,
    accentSoft: `rgba(${rgb},0.6)`,
    // Accent-family text on the light surface: the light palette's accent,
    // which meets 4.5:1 on porcelain.
    accentText: "#3E7B3A",
    gold: p.accent,
    accentRGB: rgb,
    onAccent: p.onAccent,
    logoGrad: `linear-gradient(150deg, ${p.accent} 0%, ${p.accent} 100%)`,
  };
}
