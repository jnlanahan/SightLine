// The messages inside a step (SPEC §4.5): coach body text, the user's bubble,
// a plan-change note and the resume divider.

import { useTokens } from "../../design/ThemeProvider";
import { CodeBlock } from "../CodeBlock";

/** A coach line at body size. `past`: inside a finished phase (secondary ink). */
export function CoachText({ text, code, past = false }: { text: string; code?: string; past?: boolean }) {
  const { palette: t, type } = useTokens();
  const [size, weight, lh] = type.body;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p
        className="sl-selectable"
        style={{ margin: 0, fontSize: size, fontWeight: weight, lineHeight: lh, color: past ? t.ink2 : t.ink, overflowWrap: "anywhere" }}
      >
        {text}
      </p>
      {code ? <CodeBlock code={code} /> : null}
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  const { palette: t, radius, type } = useTokens();
  return (
    <div
      className="sl-selectable"
      style={{
        alignSelf: "flex-end",
        maxWidth: "86%",
        padding: "8px 12px",
        borderRadius: radius.bubble,
        background: t.you,
        color: t.ink,
        fontSize: type.body[0],
        lineHeight: 1.45,
        overflowWrap: "anywhere",
      }}
    >
      {text}
    </div>
  );
}

/** "Plan updated: added …" — a dashed accent box (D7). */
export function PlanNoteBox({ text }: { text: string }) {
  const { palette: t, type } = useTokens();
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px", borderRadius: 10,
        border: `1px dashed ${t.accent}`,
        fontSize: type.note[0], lineHeight: type.note[2], color: t.ink2,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

/** A 1 px rule with centred text: "Picked up where you left off · 2 days ago". */
export function ResumeDivider({ text }: { text: string }) {
  const { palette: t } = useTokens();
  const rule = { flex: 1, height: 1, background: t.line } as const;
  return (
    <div role="separator" aria-label={text} style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={rule} />
      <span style={{ fontSize: 11.5, color: t.ink2, whiteSpace: "nowrap" }}>{text}</span>
      <span style={rule} />
    </div>
  );
}
