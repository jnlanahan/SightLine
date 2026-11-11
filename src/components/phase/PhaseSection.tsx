// One phase's chat (SPEC §4.3, §4.4). A past phase is compact and sits on the
// panel background; the current phase sits on the card surface, fills the
// viewport (past phases stack above it), and pushes its footer to the bottom.

import type { ReactNode } from "react";
import { useTokens } from "../../design/ThemeProvider";
import { IconCheck } from "../../design/lineIcons";

export interface PhaseSectionProps {
  /** 0-based phase index (data-phase, for scrolling to it). */
  index: number;
  /** "Phase n of N" eyebrow; omitted for a single-phase walkthrough. */
  eyebrow?: string;
  /** The phase title; "" for a single-phase walkthrough. */
  title: string;
  current: boolean;
  /** The coach's state word, shown on the current phase's eyebrow row. */
  stateWord?: string;
  /** Needs-you banner, at the top of the current section (WP7). */
  banner?: ReactNode;
  /** Footer of the current phase (WP5), pushed to the bottom. */
  footer?: ReactNode;
  /** Quick answer (SPEC §5): no eyebrow row, gap 14. */
  bare?: boolean;
  children?: ReactNode;
}

export function PhaseSection({ index, eyebrow, title, current, stateWord, banner, footer, bare = false, children }: PhaseSectionProps) {
  const { palette: t, type } = useTokens();
  const titleType = current ? type.phaseTitle : type.pastPhaseTitle;

  return (
    <section
      data-phase={index}
      aria-label={eyebrow ? `${eyebrow}${title ? `: ${title}` : ""}` : title || undefined}
      style={
        current
          ? {
              minHeight: "100%",
              boxSizing: "border-box",
              padding: "24px 20px 18px",
              display: "flex",
              flexDirection: "column",
              gap: bare ? 14 : 12,
              background: t.card,
            }
          : {
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              borderBottom: `1px solid ${t.line}`,
              background: "transparent",
            }
      }
    >
      {current && banner}
      {bare ? null : <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 15 }}>
        <div
          style={{
            fontSize: type.eyebrow[0],
            fontWeight: type.eyebrow[1],
            letterSpacing: type.eyebrow[3],
            textTransform: "uppercase",
            color: t.ink2,
          }}
        >
          {eyebrow ?? ""}
        </div>
        {current ? (
          stateWord ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.ink2 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent }} />
              {stateWord}
            </div>
          ) : null
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: t.ink2 }}>
            <IconCheck size={13} stroke={2.6} />
            Done
          </div>
        )}
      </div>}
      {title ? (
        <div
          style={{
            marginTop: current ? 0 : -4,
            fontSize: titleType[0],
            fontWeight: titleType[1],
            lineHeight: titleType[2],
            color: current ? t.ink : t.ink2,
          }}
        >
          {title}
        </div>
      ) : null}
      {children}
      {current && footer ? <div style={{ marginTop: "auto", paddingTop: 10 }}>{footer}</div> : null}
    </section>
  );
}
