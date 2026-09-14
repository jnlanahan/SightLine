import { useTheme } from "../design/ThemeProvider";
import { Logo, CtrlBtn } from "../design/primitives";
import { IPause, ISpeakerOff, ISpeakerOn } from "../design/icons";
import { lt } from "../design/theme";
import type { SessionStatus } from "../lib/api";

/* Docked-collapsed "rail": the reserved strip shrinks to a thin vertical
   band so the desktop gets most of its width back while the session (voice,
   capture loop) keeps running. Everything is stacked top→bottom. */

export function DockRail({
  status,
  statusText,
  dotColor,
  instruction,
  ttsEnabled,
  isPaused,
  onToggleVoice,
  onPause,
  onResume,
  onExpand,
}: {
  status: SessionStatus;
  statusText: string;
  dotColor: string;
  instruction: string;
  ttsEnabled: boolean;
  isPaused: boolean;
  onToggleVoice(): void;
  onPause(): void;
  onResume(): void;
  onExpand(): void;
}) {
  const T = useTheme();
  const pulses = status === "watching" || status === "thinking";
  const lineActive =
    status === "watching" ||
    status === "thinking" ||
    status === "researching" ||
    status === "evaluating";

  return (
    <div
      title={instruction || statusText}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        height: "100%",
        padding: "12px 0 12px",
      }}
    >
      <button
        type="button"
        className="no-drag"
        onClick={onExpand}
        title="Expand SightLine"
        style={{
          border: 0,
          padding: 0,
          background: "transparent",
          cursor: "pointer",
          lineHeight: 0,
        }}
      >
        <Logo size={36} radius={10} />
      </button>

      {/* Status dot */}
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          width: 8,
          height: 8,
          flexShrink: 0,
        }}
        title={statusText}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: dotColor,
          }}
        />
        {pulses && (
          <span
            style={{
              position: "absolute",
              inset: -3,
              borderRadius: "50%",
              background: dotColor,
              opacity: 0.3,
              animation: "sl-live-pulse 1.5s ease-out infinite",
            }}
          />
        )}
      </span>

      {/* Vertical sight line — the header hairline, rotated into the rail */}
      <span
        aria-hidden
        style={{
          flex: 1,
          width: 2,
          borderRadius: 2,
          minHeight: 40,
          background: lineActive
            ? `linear-gradient(180deg, transparent, ${T.accent} 30%, ${T.accent} 70%, transparent)`
            : lt(0.1),
          animation: lineActive
            ? "sl-line-breathe 3.2s ease-in-out infinite"
            : undefined,
        }}
      />

      <div
        className="no-drag"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {/* Speaker (output), not mic (input) — same glyph and red muted state
            as the full panel, so "the app went silent" is visible from the
            rail too. */}
        <CtrlBtn
          title={ttsEnabled ? "Voice on — click to mute the coach" : "Muted — click to turn the coach's voice on"}
          onClick={onToggleVoice}
          color={ttsEnabled ? T.accentText : "#C22F2F"}
        >
          {ttsEnabled ? <ISpeakerOn c={T.accent} /> : <ISpeakerOff c="#C22F2F" />}
        </CtrlBtn>
        <button
          className="no-drag"
          onClick={isPaused ? onResume : onPause}
          title={isPaused ? "Resume" : "Pause"}
          style={{
            width: 32,
            height: 32,
            border: 0,
            borderRadius: 10,
            cursor: "pointer",
            background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
            color: T.onAccent,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          {isPaused ? <RailPlayIcon c={T.onAccent} /> : <IPause c={T.onAccent} />}
        </button>
        <CtrlBtn title="Expand SightLine" onClick={onExpand}>
          <ExpandChevron />
        </CtrlBtn>
      </div>
    </div>
  );
}

function RailPlayIcon({ c }: { c?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 3.5l8 4.5-8 4.5V3.5Z" fill={c || "currentColor"} />
    </svg>
  );
}

function ExpandChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M4.5 2l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
