// The footer of the current phase (SPEC §4.6, §7): the highlight note, the
// one-tap replies by how the coach is helping, and a status row while the
// coach is looking after the user asked something.
//
// Every reply goes through the caller's submitFollowUp with the exact words
// from src/lib/quickReplies.ts — never retyped here, never a new path.

import type { ReactNode } from "react";
import { useTokens } from "../../design/ThemeProvider";
import { IconCheck } from "../../design/lineIcons";
import {
  CHECK_WORK_REPLY,
  GOAL_AGREED_REPLY,
  STEP_DONE_REPLY,
  STUCK_REPLY,
} from "../../lib/quickReplies";
import type { Stance } from "../../lib/api";

export const FOOTER_POINTING = "Outlined on your screen. I'll move on when I see it's done.";
export const FOOTER_NOT_POINTING = "I'll move on when I see it's done.";

export interface PhaseFooterProps {
  stance: Stance;
  /** A pointer box is on the user's screen for this step. */
  pointing: boolean;
  /** While set, the replies give way to this status row ("Checking your
   *  screen", …). The caller maps coach state to words (SPEC §7). */
  statusRow?: string | null;
  /** The goal is waiting on a yes: one filled "Yes, start" instead. */
  goalPending?: boolean;
  paused?: boolean;
  onReply(text: string): void;
  onResume?(): void;
}

export function PhaseFooter(p: PhaseFooterProps) {
  const { palette: t, type } = useTokens();

  const note = (text: string, icon?: ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: type.note[0], lineHeight: type.note[2], color: t.ink2 }}>
      {icon}
      <span>{text}</span>
    </div>
  );

  let body: ReactNode;
  if (p.statusRow) {
    body = (
      <div role="status" style={{ height: 38, display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, color: t.ink2 }}>
        <span className="sl-pulse" aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent }} />
        {p.statusRow}
      </div>
    );
  } else if (p.paused) {
    body = <Pill filled label="Resume watching" onClick={() => p.onResume?.()} />;
  } else if (p.goalPending) {
    body = <Pill filled label="Yes, start" onClick={() => p.onReply(GOAL_AGREED_REPLY)} />;
  } else if (p.stance === "watch") {
    body = (
      <Row>
        <Pill label="Check my work" onClick={() => p.onReply(CHECK_WORK_REPLY)} />
        <Pill label="I'm stuck" onClick={() => p.onReply(STUCK_REPLY)} />
      </Row>
    );
  } else {
    body = (
      <Row>
        <Pill label="I did it" icon={<IconCheck size={13} stroke={2.6} />} onClick={() => p.onReply(STEP_DONE_REPLY)} />
        <Pill label="I'm stuck" onClick={() => p.onReply(STUCK_REPLY)} />
      </Row>
    );
  }

  // The note: pointing → "Outlined on your screen…"; guiding → the plain
  // promise; watching, paused or waiting on the goal → neither.
  let top: ReactNode = null;
  if (p.goalPending && !p.paused) {
    top = note("Not quite? Type or say what you want instead.");
  } else if (!p.paused && p.stance === "guide") {
    top = p.pointing
      ? note(
          FOOTER_POINTING,
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>,
        )
      : note(FOOTER_NOT_POINTING);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {p.goalPending ? body : top}
      {p.goalPending ? top : body}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>;
}

function Pill({ label, icon, filled = false, onClick }: { label: string; icon?: ReactNode; filled?: boolean; onClick(): void }) {
  const { palette: t, size } = useTokens();
  return (
    <button
      type="button"
      className="sl-focus no-drag"
      onClick={onClick}
      style={{
        height: size.pill,
        borderRadius: 999,
        border: filled ? 0 : `1px solid ${t.chip}`,
        background: filled ? t.accent : "transparent",
        color: filled ? t.onAccent : t.ink,
        fontSize: 13,
        fontWeight: filled ? 700 : 600,
        padding: "0 14px",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        alignSelf: "flex-start",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
