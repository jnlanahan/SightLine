// The top bar. One bar for the whole app: Home and an open chat show the same
// thing in the same place — a title, one status line, then Settings (a cog)
// and the "⋯" menu at the right edge, always both, always in that order.
//
// (Second live run, 11 November 2026: "the same top menu needs to show no
// matter if you're in a chat or not… when you go into a chat, the settings go
// away". Before this, Home had an older bar of eight buttons and a chat had
// only "⋯".)
//
// What differs is only what the screen in front needs:
//   - Home: the logo and the app's name.
//   - A quick answer has no rail (SPEC §5), so All chats, mute and pause sit
//     here instead. Collapse is in the "⋯" menu.

import type { ReactNode } from "react";
import { useTokens } from "../../design/ThemeProvider";
import {
  IconList,
  IconMore,
  IconPause,
  IconPlay,
  IconSettings,
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
  /** The line under the title. */
  status: string;
  /** A small accent dot before the status: Home, and a quick answer. */
  statusDot?: boolean;
  /** Home: the logo in front of the title. */
  logo?: ReactNode;
  menuOpen: boolean;
  onMenu(): void;
  onSettings(): void;
  /** Quick layout only: the controls the rail would otherwise carry. */
  quickControls?: {
    muted: boolean;
    paused: boolean;
    onAllChats(): void;
    onMute(): void;
    onPause(): void;
  };
}

export function PhaseHeader({ title, status, statusDot, logo, menuOpen, onMenu, onSettings, quickControls: q }: PhaseHeaderProps) {
  const { palette: t, type } = useTokens();

  const btn = (label: string, icon: ReactNode, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <button
      type="button"
      className="sl-focus no-drag"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...extra}
      style={{
        width: 40,
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
        padding: q ? "8px 4px 8px 4px" : logo ? "8px 4px 8px 14px" : "8px 4px 8px 20px",
        borderBottom: `1px solid ${t.line}`,
        flexShrink: 0,
      }}
    >
      {q && (
        <button
          type="button"
          className="sl-focus no-drag"
          aria-label="All chats"
          title="All chats"
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
      {logo && <span style={{ flexShrink: 0, display: "flex", marginRight: 10 }}>{logo}</span>}
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
          {statusDot && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{status}</span>
        </div>
      </div>
      {q && (
        <>
          {btn(
            q.muted ? "Turn voice on" : "Mute voice",
            q.muted ? <IconSpeakerOff size={18} /> : <IconSpeaker size={18} />,
            q.onMute,
            { "aria-pressed": q.muted, title: q.muted ? "Voice is muted" : "Mute voice" },
          )}
          {btn(q.paused ? "Resume watching" : "Pause watching", q.paused ? <IconPlay size={18} /> : <IconPause size={18} />, q.onPause)}
        </>
      )}
      {/* The same two, in the same place, on every screen. */}
      {btn("Settings", <IconSettings size={19} />, onSettings)}
      {btn("More options", <IconMore size={18} />, onMenu, { "aria-haspopup": "menu", "aria-expanded": menuOpen })}
    </header>
  );
}
