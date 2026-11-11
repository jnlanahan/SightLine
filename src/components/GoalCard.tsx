import { useTheme } from "../design/ThemeProvider";

interface Props {
  // The goal as the coach said it back (or the user's own words, if the coach
  // sent none).
  goal: string;
  // What the screen will show when the goal is reached. May be empty.
  doneWhen: string;
  // A look is in flight — the user's answer is on its way to the coach.
  busy: boolean;
  onAgree(): void;
}

/**
 * The goal, waiting on a yes.
 *
 * Shown in place of the current-step card after the coach has said the goal
 * back and before the user has answered. One tap agrees; anything typed or
 * spoken instead is a correction, and the coach says the goal back again.
 * Same dark card as a step, so it sits where the eye already goes.
 */
export function GoalCard({ goal, doneWhen, busy, onAgree }: Props) {
  const T = useTheme();
  return (
    <div
      style={{
        borderRadius: 13,
        background: T.instr,
        border: `1px solid rgba(0,0,0,0.25)`,
        boxShadow: "0 12px 30px -12px rgba(22,26,14,0.55)",
        padding: "13px 15px",
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.13em",
        textTransform: "uppercase", color: "rgba(240,238,228,0.5)",
      }}>
        Is this the goal?
      </div>
      <div
        className="sl-selectable animate-fade-in"
        style={{
          marginTop: 8, fontFamily: T.font, fontSize: 14.5, fontWeight: 500,
          lineHeight: 1.55, color: "#F4F1E8",
        }}
      >
        {goal}
      </div>
      {doneWhen && (
        <div
          className="sl-selectable"
          style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: "rgba(240,238,228,0.72)" }}
        >
          <span style={{ fontWeight: 700 }}>Done when:</span> {doneWhen}
        </div>
      )}
      <button
        type="button"
        className="no-drag"
        onClick={onAgree}
        disabled={busy}
        title="Agree the goal and get the first step"
        style={{
          marginTop: 12, width: "100%",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          padding: "9px 12px", border: 0, borderRadius: 10,
          background: busy
            ? "rgba(244,241,232,0.12)"
            : `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
          color: busy ? "rgba(244,241,232,0.45)" : T.onAccent,
          fontSize: 12.5, fontWeight: 700, letterSpacing: "0.02em",
          cursor: busy ? "default" : "pointer",
          transition: "opacity 150ms",
        }}
      >
        {busy ? "One sec…" : "Yes — start"}
      </button>
      <div style={{ marginTop: 8, fontSize: 11, color: "rgba(240,238,228,0.5)", textAlign: "center" }}>
        Not quite? Type or say what you want instead.
      </div>
    </div>
  );
}
