// sightline/primitives.tsx
// Shared atoms + building blocks for the SightLine overlay components.
import React, { useMemo } from "react";
import { useTheme } from "./ThemeProvider";
import { ar, lt, waveColor } from "./theme";
import { IMic, ISend } from "./icons";

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

/** Animated speech waveform. Bars are colored across the accent's gradient. */
export function Waveform({ count = 42, height = 44, gap = 2, glow = true }: { count?: number; height?: number; gap?: number; glow?: boolean }) {
  const T = useTheme();
  const bars = useMemo(
    () => Array.from({ length: count }, (_, i) => ({ f: i / (count - 1), delay: -(Math.random() * 1.05).toFixed(2), dur: (0.72 + Math.random() * 0.6).toFixed(2) })),
    [count],
  );
  return (
    <div style={{ flex: 1, height, display: "flex", alignItems: "center", gap, overflow: "hidden" }}>
      {bars.map((b, i) => {
        const c = waveColor(T.waveStops, b.f);
        return <span key={i} style={{
          flex: 1, borderRadius: 2, height: "100%", background: c, transformOrigin: "center",
          boxShadow: glow ? `0 0 6px ${c}77` : "none",
          animation: `sl-bar ${b.dur}s ease-in-out infinite`, animationDelay: `${b.delay}s`,
        }} />;
      })}
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink3 }}>{children}</div>;
}

export function Cmd({ children, small }: { children: React.ReactNode; small?: boolean }) {
  const T = useTheme();
  return <code style={{
    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace', fontSize: small ? 11.5 : 12.5, fontWeight: 600, color: T.ink,
    background: ar(T.accentRGB, 0.2), border: `1px solid ${ar(T.accentRGB, 0.42)}`, padding: "1px 6px", borderRadius: 6, whiteSpace: "nowrap",
  }}>{children}</code>;
}

export function Check({ s = 11, c }: { s?: number; c?: string }) {
  const T = useTheme();
  return <svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M2 6.2 L5 9 L10 3" stroke={c || T.green} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
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

export function ChatInput({ compact, placeholder = "Type a message…", value, onChange, onSend, onMic }: {
  compact?: boolean; placeholder?: string; value?: string;
  onChange?: (v: string) => void; onSend?: () => void; onMic?: () => void;
}) {
  const T = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: lt(0.05), border: `1px solid ${T.border}`, borderRadius: 13, padding: "5px 6px 5px 14px" }}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSend?.(); }}
        style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", color: T.ink, fontSize: compact ? 13 : 13.5, fontFamily: "inherit" }}
      />
      <button className="sl-ctrl" title="Voice input" onClick={onMic} style={{ width: 32, height: 32, border: 0, borderRadius: 9, background: "transparent", color: T.ink2, display: "grid", placeItems: "center", cursor: "pointer" }}><IMic /></button>
      <button title="Send" onClick={onSend} style={{ width: 32, height: 32, border: 0, borderRadius: 9, background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`, color: T.onAccent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}` }}><ISend c={T.onAccent} /></button>
    </div>
  );
}

/** "Now speaking" indicator — deliberately separate from the instruction card. */
export function SpeakingStrip({ waveCount = 36, height = 40 }: { waveCount?: number; height?: number }) {
  const T = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, height, padding: "0 14px", borderRadius: 11, background: ar(T.accentRGB, 0.08), border: `1px solid ${ar(T.accentRGB, 0.18)}` }}>
      <Waveform count={waveCount} height={height - 16} />
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.13em", color: T.accentText, flexShrink: 0 }}>SPEAKING</span>
    </div>
  );
}

export function StepRow({ label, dim }: { label: string; dim?: boolean }) {
  const T = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", borderRadius: 12, background: dim ? lt(0.035) : lt(0.06), border: `1px solid ${dim ? lt(0.06) : lt(0.09)}`, fontSize: 13.5, fontWeight: 500, color: dim ? T.ink2 : T.ink }}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, background: ar(T.greenRGB, 0.16) }}><Check /></span>
      {label}
    </div>
  );
}

export function MiniStep({ label }: { label: string }) {
  const T = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.ink2, padding: "1px 0" }}>
      <span style={{ width: 15, height: 15, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, background: ar(T.greenRGB, 0.16) }}><Check s={9} /></span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

export function Panel({ children, width, pad = 22, gap = 16 }: { children: React.ReactNode; width: number | string; pad?: number; gap?: number }) {
  const T = useTheme();
  return (
    <div style={{
      position: "relative", zIndex: 1, width, borderRadius: 22, padding: pad, color: T.ink,
      background: `${T.glassGrad}, ${T.glassBg}`,
      backdropFilter: "blur(26px) saturate(1.35)", WebkitBackdropFilter: "blur(26px) saturate(1.35)",
      border: `1px solid ${T.border}`,
      boxShadow: `0 1px 0 0 ${T.hi} inset, 0 30px 70px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.3)`,
      fontFamily: T.font,
      display: "flex", flexDirection: "column", gap,
    }}>{children}</div>
  );
}
