import { useEffect, useRef, useState } from "react";
import { useTokens } from "../design/ThemeProvider";
import { ISend } from "../design/icons";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";

// Redesign SPEC §4.8: the caller picks the placeholder ("Ask about step 3",
// "Ask or tell it anything", "Ask a follow-up").
const PLACEHOLDER = "Ask or tell it anything";

const KEY_LABEL: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  f8: "F8",
  f9: "F9",
  none: "",
};

interface Props {
  placeholder?: string;
  isThinking: boolean;
  onSubmit(text: string): void;
  onStartTalking(): void;
  onStopTalking(): void;
}

/**
 * The message bar: type, or hold the mic to talk.
 *
 * The mic is press-and-hold, matching the push-to-talk key exactly, because
 * both paths run the same barge-in: the coach stops speaking the moment you
 * start. A click-to-toggle mic would leave the mic open when someone let go
 * expecting it to close.
 */
export function Composer({
  placeholder = PLACEHOLDER,
  isThinking,
  onSubmit,
  onStartTalking,
  onStopTalking,
}: Props) {
  const { palette: t, font, radius } = useTokens();
  const [value, setValue] = useState("");
  const listening = useSession((s) => s.listening);
  const transcribing = useSession((s) => s.transcribing);
  const lastTranscript = useSession((s) => s.lastTranscript);
  const pttKey = useSettings((s) => s.settings?.pushToTalkKey ?? "f9");
  const holdingRef = useRef(false);

  // If the hold ends anywhere — outside the button, in another window — the
  // mic still closes. A latched-open mic is the worst failure here.
  useEffect(() => {
    if (!listening) return;
    const release = () => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      onStopTalking();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [listening, onStopTalking]);

  function submit() {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
  }

  const hasValue = value.trim().length > 0;
  const keyLabel = KEY_LABEL[pttKey] ?? "";
  const busyVoice = listening || transcribing;

  // The restyle keeps every handler: the press-and-hold mic below and the
  // window-level release above are exactly as before. While listening the
  // input shows what is happening and the mic turns accent.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "0 12px 12px" }}>
      {lastTranscript && !busyVoice && (
        <div
          style={{
            fontSize: 11.5,
            color: t.ink2,
            padding: "0 4px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={lastTranscript}
        >
          heard: “{lastTranscript}”
        </div>
      )}
      <div
        className="no-drag"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: t.input,
          border: `1px solid ${t.line}`,
          borderRadius: radius.composer,
          padding: "4px 4px 4px 14px",
        }}
      >
        <label htmlFor="sl-composer-input" className="sl-sr-only">
          Message the coach
        </label>
        <input
          id="sl-composer-input"
          type="text"
          value={busyVoice ? "" : value}
          readOnly={busyVoice}
          placeholder={
            listening
              ? `Listening — keep talking${keyLabel ? ` (release ${keyLabel})` : ""}`
              : transcribing
                ? "Getting that down…"
                : placeholder
          }
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              setValue("");
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 44,
            border: 0,
            outline: "none",
            background: "transparent",
            color: t.ink,
            fontSize: 14,
            fontFamily: font.sans,
          }}
        />

        {hasValue && !busyVoice && (
          <button
            type="button"
            className="sl-focus"
            onClick={submit}
            aria-label="Send"
            title={isThinking ? "Send — it'll pick this up next" : "Send"}
            style={{
              width: 44,
              height: 44,
              border: 0,
              borderRadius: 12,
              background: "transparent",
              color: t.ink2,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <ISend c={t.ink2} />
          </button>
        )}

        <button
          type="button"
          className="sl-focus"
          aria-label="Hold to talk"
          aria-pressed={listening}
          title={
            keyLabel
              ? `Hold to talk (or hold ${keyLabel} anywhere)`
              : "Hold to talk"
          }
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            holdingRef.current = true;
            onStartTalking();
          }}
          style={{
            width: 44,
            height: 44,
            border: 0,
            borderRadius: 12,
            cursor: "pointer",
            background: listening ? t.accent : t.btn,
            color: listening ? t.onAccent : t.btnInk,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          {listening ? <ListeningBars /> : transcribing ? <PulseDot color={t.btnInk} /> : <MicIcon />}
        </button>
      </div>
    </div>
  );
}

function ListeningBars() {
  // Fixed phases rather than random, so the animation is identical every time
  // it appears — a mic indicator that looks different each press reads as a
  // glitch.
  const phases = [0, 0.18, 0.36, 0.12, 0.28];
  return (
    <span
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: 16,
        flexShrink: 0,
      }}
    >
      {phases.map((delay, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: "100%",
            borderRadius: 2,
            background: "currentColor",
            animation: "sl-bar 0.9s ease-in-out infinite",
            animationDelay: `-${delay}s`,
          }}
        />
      ))}
    </span>
  );
}

function PulseDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        animation: "sl-blink 1.2s ease-in-out infinite",
      }}
    />
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect
        x="5"
        y="1.5"
        width="4"
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M2.5 7c0 2.5 2 4.5 4.5 4.5S11.5 9.5 11.5 7M7 11.5v1.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
