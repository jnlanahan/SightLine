// src/design/tokens.ts
// SightLine design tokens for the phase-chat redesign (docs/redesign/SPEC.md).
// Components read colours from the active palette, never raw hex.

export type PaletteName = "graphite" | "porcelain" | "midnight";

export interface Palette {
  /** Shown in Settings. */
  label: string;
  /** Rail background. */
  rail: string;
  /** Panel background; past phase sections sit on this. */
  bg: string;
  /** Current phase section and the quick-answer section. */
  card: string;
  /** Primary text. */
  ink: string;
  /** Secondary text: labels, past steps, status lines. */
  ink2: string;
  /** Upcoming circle borders and upcoming step dots. Not for text. */
  muted: string;
  /** Hairlines and borders. */
  line: string;
  /** The one accent: current circle, halo, status dot, ready pill. */
  accent: string;
  /** Text and icons on top of `accent`. */
  onAccent: string;
  /** Done circles and dots. */
  doneFill: string;
  /** Check marks on top of `doneFill`. */
  doneInk: string;
  /** One-tap reply borders. */
  chip: string;
  /** Code block background. */
  code: string;
  /** The user's message bubble. */
  you: string;
  /** Solid buttons: Copy, mic. */
  btn: string;
  btnInk: string;
  /** Composer background. */
  input: string;
  /** Needs-you banner. */
  warn: string;
  warnSoft: string;
  /** Glow overlay on the user's real screen (outline and pointer box). */
  glow: string;
  /** Whether the palette is dark, for native scrollbars and the window background. */
  dark: boolean;
}

export const PALETTES: Record<PaletteName, Palette> = {
  graphite: {
    label: "Graphite",
    rail: "#0F1112",
    bg: "#17191A",
    card: "#1E2122",
    ink: "#ECEDE8",
    ink2: "#A3A79E",
    muted: "#5A5E5B",
    line: "#2A2E30",
    accent: "#9BD45A",
    onAccent: "#152009",
    doneFill: "#ECEDE8",
    doneInk: "#17191A",
    chip: "#3A3E40",
    code: "#0F1112",
    you: "#2A2E30",
    btn: "#ECEDE8",
    btnInk: "#17191A",
    input: "#1E2122",
    warn: "#F2A65A",
    warnSoft: "rgba(242,166,90,0.12)",
    glow: "#9BD45A",
    dark: true,
  },
  porcelain: {
    label: "Porcelain",
    rail: "#E9E7E1",
    bg: "#F6F5F1",
    card: "#FFFFFF",
    ink: "#1E1F1C",
    ink2: "#5D5F58",
    muted: "#9C9E95",
    line: "#DDDBD3",
    accent: "#3E7B3A",
    onAccent: "#FFFFFF",
    doneFill: "#1E1F1C",
    doneInk: "#FFFFFF",
    chip: "#CFCDC4",
    code: "#EFEDE7",
    you: "#E9E7E0",
    btn: "#1E1F1C",
    btnInk: "#F6F5F1",
    input: "#FFFFFF",
    warn: "#B4531F",
    warnSoft: "rgba(180,83,31,0.08)",
    glow: "#4F9A49",
    dark: false,
  },
  midnight: {
    label: "Midnight",
    rail: "#0A0F1C",
    bg: "#0F1626",
    card: "#151E31",
    ink: "#E8ECF4",
    ink2: "#9AA6BD",
    muted: "#4A5874",
    line: "#22304A",
    accent: "#6EE7B7",
    onAccent: "#052E1F",
    doneFill: "#E8ECF4",
    doneInk: "#0F1626",
    chip: "#2C3A57",
    code: "#0A0F1C",
    you: "#1E2A42",
    btn: "#E8ECF4",
    btnInk: "#0F1626",
    input: "#151E31",
    warn: "#F5B971",
    warnSoft: "rgba(245,185,113,0.12)",
    glow: "#6EE7B7",
    dark: true,
  },
};

// The light set. The design made dark Graphite the default and flagged that
// it might draw the eye beside bright programs (docs/redesign DECISIONS D9);
// after using it, the owner asked for it not to be the default (11 Nov 2026).
export const DEFAULT_PALETTE: PaletteName = "porcelain";

/** The old four-accent setting, mapped onto the new palettes on first read. */
export const ACCENT_TO_PALETTE: Record<"lime" | "cobalt" | "rose" | "slate", PaletteName> = {
  lime: "porcelain",
  cobalt: "midnight",
  rose: "porcelain",
  slate: "porcelain",
};

// ── The user's own accent colour ──
// A colour set fixes the backgrounds and text. The accent (the current
// circle, the halo, buttons, the outline on the real screen) can be replaced
// with any colour the user picks in Settings.

/** One-tap accent choices offered beside the custom picker. */
export const ACCENT_SWATCHES: readonly { name: string; hex: string }[] = [
  { name: "Green", hex: "#3E9B4F" },
  { name: "Teal", hex: "#1F9E97" },
  { name: "Blue", hex: "#3B7DDD" },
  { name: "Violet", hex: "#8A63D2" },
  { name: "Pink", hex: "#D6497F" },
  { name: "Orange", hex: "#DD7A1F" },
];

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Pure black and pure white on purpose: between them, one always reaches
// 4.5:1 on any colour (the worst case is about 4.58). A softer near-black
// does not — on a mid blue it fell to 4.42.
const INK_ON_ACCENT_DARK = "#000000";
const INK_ON_ACCENT_LIGHT = "#FFFFFF";

/**
 * A colour set with the user's accent in place of its own. Text on the accent
 * is whichever of near-black and white reads better, which is always at least
 * 4.5:1. Anything that is not a #rrggbb colour leaves the set untouched.
 */
export function withAccent(p: Palette, hex: string | null | undefined): Palette {
  if (!isHexColor(hex)) return p;
  const accent = hex.toUpperCase();
  const onAccent =
    contrastRatio(accent, INK_ON_ACCENT_DARK) >= contrastRatio(accent, INK_ON_ACCENT_LIGHT)
      ? INK_ON_ACCENT_DARK
      : INK_ON_ACCENT_LIGHT;
  return { ...p, accent, onAccent, glow: accent };
}

/**
 * The accent as TEXT on a surface: the accent itself when it is readable
 * there, otherwise the set's ink. A pale yellow accent is fine as a button
 * and unreadable as a word on a light panel.
 */
export function accentInkOn(p: Palette, surface: string = p.bg): string {
  return isHexColor(p.accent) && isHexColor(surface) && contrastRatio(p.accent, surface) >= 4.5
    ? p.accent
    : p.ink;
}

export const font = {
  sans: '"Manrope Variable", "Manrope", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  mono: '"Cascadia Mono", Consolas, ui-monospace, monospace',
} as const;

/** [size px, weight, line-height, letter-spacing px] */
export const type = {
  lead: [21, 600, 1.35, -0.3],
  phaseTitle: [18, 700, 1.3, 0],
  pastPhaseTitle: [15, 600, 1.3, 0],
  title: [14, 700, 1.3, 0],
  body: [13.5, 400, 1.5, 0],
  label: [13, 600, 1.35, 0],
  button: [13, 600, 1, 0],
  note: [12.5, 400, 1.45, 0],
  status: [12, 400, 1.35, 0],
  eyebrow: [11, 700, 1.2, 1.2],
  tag: [10.5, 700, 1.2, 0.6],
  code: [13, 400, 1.45, 0],
  headline: [22, 700, 1.3, 0],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const size = {
  rail: 64,
  defaultPanel: 400,
  iconButton: 44,
  pill: 38,
  readyPill: 40,
  composerInput: 44,
  circle: { done: 30, current: 38, upcoming: 30, step: 20, singleDone: 26, singleCurrent: 34 },
  dot: 6,
  connector: { w: 2, h: 22, hSingle: 20 },
  stepIndent: 30,
} as const;

export const radius = {
  control: 10,
  composer: 14,
  bubble: "12px 12px 4px 12px",
  code: 10,
  banner: 12,
  pill: 999,
  floatingPanel: 14,
} as const;

export const motion = {
  haloMs: 5000,
  pulseMs: 1200,
  pillRiseMs: 250,
  railEnterMs: 200,
  /** "At bottom" threshold for auto-scroll. */
  atBottomPx: 60,
  /** Scroll a new step into view only if it would sit this close to the bottom edge. */
  stepNearBottomPx: 140,
  stepTopOffsetPx: 16,
} as const;
