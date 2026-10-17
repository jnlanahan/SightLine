// sightline/theme.ts
// Accent palettes + theme tokens for the SightLine overlay components.

import type { AccentName } from "../../electron/types";
export type { AccentName };

export interface AccentDef {
  accent: string;
  deep: string;
  soft: string;
  gold: string;
  text: string; // accent-family color dark enough to read on the light panel
  rgb: string; // "r,g,b" — used for alpha variants
  on: string; // text color on top of the accent
  logo: string; // logo/orb gradient
  wave: [number, number, number][]; // waveform gradient stops
}

export const ACCENTS: Record<AccentName, AccentDef> = {
  lime: {
    accent: "#C2E84B", deep: "#8FBE2E", soft: "#D7F27A", gold: "#E6F59A", text: "#5C8A14", rgb: "194,232,75", on: "#1b2400",
    logo: "linear-gradient(150deg,#E6F59A 0%,#C2E84B 48%,#8FBE2E 100%)",
    wave: [[230, 245, 154], [194, 232, 75], [159, 209, 46], [127, 181, 46]],
  },
  cobalt: {
    accent: "#4F8BF2", deep: "#2E63D6", soft: "#6FA8FF", gold: "#9FC2FF", text: "#2456C4", rgb: "79,139,242", on: "#ffffff",
    logo: "linear-gradient(150deg,#8FB8FF 0%,#4F8BF2 48%,#2E63D6 100%)",
    wave: [[143, 184, 255], [79, 139, 242], [62, 111, 224], [88, 104, 232]],
  },
  rose: {
    accent: "#FF6B81", deep: "#E0364F", soft: "#FF9AAB", gold: "#FFB3C0", text: "#C6203A", rgb: "255,107,129", on: "#33000d",
    logo: "linear-gradient(150deg,#FFB3C0 0%,#FF6B81 48%,#E0364F 100%)",
    wave: [[255, 179, 192], [255, 107, 129], [240, 67, 106], [224, 54, 79]],
  },
  slate: {
    accent: "#9FB2C8", deep: "#6B7E96", soft: "#C2CFDE", gold: "#CDD8E6", text: "#4E6076", rgb: "159,178,200", on: "#10141b",
    logo: "linear-gradient(150deg,#CDD8E6 0%,#9FB2C8 48%,#6B7E96 100%)",
    wave: [[205, 216, 230], [159, 178, 200], [126, 145, 171], [107, 126, 150]],
  },
};

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
  waveStops: [number, number, number][];
}

/** ink-on-porcelain hairline / tint at a given alpha */
export const lt = (a: number) => `rgba(44,48,34,${a})`;
/** accent rgb at a given alpha */
export const ar = (rgb: string, a: number) => `rgba(${rgb},${a})`;

export function makeTheme(name: AccentName = "lime"): SightLineTheme {
  const a = ACCENTS[name] ?? ACCENTS.lime;
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
    font: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Inter", sans-serif',
    display: '"AW Conqueror Didot", "Didot", "Bodoni MT", "Playfair Display", Georgia, serif',
    accent: a.accent, accentDeep: a.deep, accentSoft: a.soft, accentText: a.text, gold: a.gold,
    accentRGB: a.rgb, onAccent: a.on, logoGrad: a.logo, waveStops: a.wave,
  };
}

/** interpolate a waveform color at fraction f (0..1) across the accent's stops */
export function waveColor(stops: [number, number, number][], f: number): string {
  const seg = f * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const t = seg - i, a = stops[i], b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
