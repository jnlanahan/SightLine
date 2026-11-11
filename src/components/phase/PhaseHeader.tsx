// The open chat's header (SPEC §4.1, §5): the chat title, one status line,
// and the "⋯" menu. For a quick answer there is no rail, so All chats and the
// rail's controls move up here.

import type { ReactNode } from "react";
import { useTokens } from "../../design/ThemeProvider";
import {
  IconCollapse,
  IconList,
  IconPause,
  IconPlay,
  IconSpeaker,
  IconSpeakerOff,
} from "../../design/lineIcons";
import type { PhaseView } from "../../lib/phaseView";

/** "Phase 2 of 3 · step 1 of 2 · Watching", "Step 3 of 5 · Watching", or the
 *  state word alone for a quick answer. */
export function headerStatusLine(view: PhaseView, stateWord: string): string {
  const { k, K } = view.stepInPhase;
  if (view.layout === "phased") {
    const n = Math.min(view.currentPhase, view.phases.length - 1) + 1;
    return `Phase ${n} of ${view.phases.length} · step ${k} of ${K} · ${stateWord}`;
  }
  if (view.layout === "single") return `Step ${k} of ${K} · ${stateWord}`;
  return stateWord;
}

export interface PhaseHeaderProps {
  title: string;
  view: PhaseView;
  stateWord: string;
  menuOpen: boolean;
  onMenu(): void;
  /** Quick layout only: the controls the rail would otherwise carry. */
  quickControls?: {
    muted: boolean;
    paused: boolean;
    onAllChats(): void;
    onMute(): void;
    onPause(): void;
    onCollapse(): void;
  };
}

export function PhaseHeader({ title, view, stateWord, menuOpen, onMenu, quickControls }: PhaseHeaderProps) {
  const { palette: t, type } = useTokens();
  const quick = view.layout === "quick";
  const q = quick ? quickControls : undefined;

  const btn = (label: string, icon: ReactNode, onClick: () => void, width: number, extra: Record<string, unknown> = {}) => (
    <button
      type="button"
      className="sl-focus no-drag"
      aria-label={label}
      onClick={onClick}
      {...extra}
      style={{
        width,
        height: 44,
        flexShrink: 0,
        border: 0,
        borderRadius: 10,
        background: "transparent",
        color: t.ink2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {icon}
    </button>
  );

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: q ? "8px 4px 8px 4px" : "8px 4px 8px 20px",
        borderBottom: `1px solid ${t.line}`,
        flexShrink: 0,
      }}
    >
      {q && (
        <button
          type="button"
          className="sl-focus no-drag"
          aria-label="All chats"
          onClick={q.onAllChats}
          style={{
            width: 44, height: 44, flexShrink: 0, border: 0, borderRadius: 10,
            background: "transparent", color: t.ink, display: "flex",
            alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}
        >
          <IconList size={20} />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: q ? 6 : 0 }}>
        <div
          title={title}
          style={{
            fontSize: type.title[0],
            fontWeight: type.title[1],
            lineHeight: type.title[2],
            color: t.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: type.status[0],
            lineHeight: type.status[2],
            color: t.ink2,
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {quick && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{headerStatusLine(view, stateWord)}</span>
        </div>
      </div>
      {q && (
        <>
          {btn(
            q.muted ? "Turn voice on" : "Mute voice",
            q.muted ? <IconSpeakerOff size={18} /> : <IconSpeaker size={18} />,
            q.onMute,
            40,
            { "aria-pressed": q.muted, title: q.muted ? "Voice is muted" : undefined },
          )}
          {btn(q.paused ? "Resume watching" : "Pause watching", q.paused ? <IconPlay size={18} /> : <IconPause size={18} />, q.onPause, 40)}
          {btn("Collapse to rail", <IconCollapse size={18} />, q.onCollapse, 40)}
        </>
      )}
      {btn(
        "Menu",
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>,
        onMenu,
        q ? 40 : 44,
        { "aria-haspopup": "menu", "aria-expanded": menuOpen },
      )}
    </header>
  );
}
