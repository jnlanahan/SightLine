// sightline/primitives.tsx
// Shared atoms + building blocks for the SightLine overlay components.
import React from "react";
import { useTheme } from "./ThemeProvider";
import { ar, lt } from "./theme";

export function Glow({
  inset = "-60px -50px -90px -50px",
  paused = false,
}: {
  inset?: string;
  /** Freeze the bloom (e.g. while the window is unfocused) — a blurred
   *  full-window layer animating at 60 fps is the single most expensive
   *  thing this UI paints. */
  paused?: boolean;
}) {
  const T = useTheme();
  return (
    <div aria-hidden style={{
      position: "absolute", inset, pointerEvents: "none", zIndex: 0, filter: "blur(34px)",
      animation: paused ? "none" : "sl-bloom 7s ease-in-out infinite",
      background: `radial-gradient(58% 50% at 64% 28%, ${ar(T.accentRGB, 0.16)} 0%, transparent 70%), radial-gradient(58% 55% at 32% 78%, ${ar(T.accentRGB, 0.09)} 0%, transparent 70%)`,
    }} />
  );
}

export function StarMark({ size }: { size: number }) {
  const T = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}>
      <path d="M16 2.5 L19 13 L29.5 16 L19 19 L16 29.5 L13 19 L2.5 16 L13 13 Z" fill="#fff" fillOpacity="0.96" />
      <circle cx="16" cy="16" r="3.4" fill={T.logoInk} />
      <circle cx="16" cy="16" r="1.5" fill={T.gold} />
    </svg>
  );
}

export function Logo({ size = 46, radius = 13 }: { size?: number; radius?: number }) {
  const T = useTheme();
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0, display: "grid", placeItems: "center",
      background: T.logoGrad,
      boxShadow: `0 0 0 1px ${ar(T.accentRGB, 0.4)} inset, 0 6px 16px -4px ${ar(T.accentRGB, 0.55)}, 0 0 22px -2px ${ar(T.accentRGB, 0.45)}`,
    }}>
      <StarMark size={size * 0.6} />
    </div>
  );
}

export function Spinner({ size = 30 }: { size?: number }) {
  const T = useTheme();
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 30 30" fill="none" style={{ display: "block", animation: "sl-spin 1.6s linear infinite" }}>
        <circle cx="15" cy="15" r="12" stroke={lt(0.13)} strokeWidth="3" />
        <path d="M15 3 a12 12 0 0 1 10.4 6" stroke={T.accent} strokeWidth="3" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink3 }}>{children}</div>;
}

export function CtrlBtn({ children, title, onClick, color, size = 36 }: { children: React.ReactNode; title?: string; onClick?: () => void; color?: string; size?: number }) {
  const T = useTheme();
  return (
    <button title={title} onClick={onClick} className="sl-ctrl" style={{
      // `size` exists for the docked sidebar, which is a ~400px strip: at the
      // full 36px these buttons overflow the header and collide with the
      // status text.
      width: size, height: size, flexShrink: 0,
      border: 0, borderRadius: Math.round(size * 0.3), background: "transparent", color: color || T.ink2,
      display: "grid", placeItems: "center", cursor: "pointer", transition: "background 150ms, color 150ms",
    }}>{children}</button>
  );
}
