// "Phase 3 is ready ↓" (SPEC §4.7, D6): shown only when the coach moved on
// while the user was scrolled up reading. Tapping it scrolls to the new
// place; reaching the bottom by hand clears it (useFollowCurrent).

import { useTokens } from "../../design/ThemeProvider";

export function ReadyPill({ label, onClick }: { label: string; onClick(): void }) {
  const { palette: t, size } = useTokens();
  return (
    <button
      type="button"
      className="sl-focus sl-rise no-drag"
      onClick={onClick}
      style={{
        position: "absolute",
        left: "50%",
        bottom: 76,
        transform: "translateX(-50%)",
        height: size.readyPill,
        borderRadius: 999,
        padding: "0 16px",
        border: 0,
        background: t.accent,
        color: t.onAccent,
        fontSize: 13,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
        boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
        cursor: "pointer",
        zIndex: 2,
      }}
    >
      {label}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
    </button>
  );
}
