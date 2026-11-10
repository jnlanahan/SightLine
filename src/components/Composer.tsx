import { useEffect, useRef, useState } from "react";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import { ISend } from "../design/icons";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";

const PLACEHOLDER = "Ask a question, or just talk";

const KEY_LABEL: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  f8: "F8",
  f9: "F9",
  none: "",
};

interface Props {
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
  isThinking,
  onSubmit,
  onStartTalking,
  onStopTalking,
}: Props) {
  const T = useTheme();
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

  if (listening || transcribing) {
    return (
      <div
        className="no-drag"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          borderRadius: 13,
          padding: "10px 14px",
          background: listening
            ? ar(T.accentRGB, 0.12)
            : lt(0.05),
          border: `1px solid ${listening ? ar(T.accentRGB, 0.4) : lt(0.1)}`,
          minHeight: 44,
        }}
      >
        {listening ? <ListeningBars /> : <PulseDot color={T.ink3} />}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 600,
            color: listening ? T.accentText : T.ink2,
          }}
        >
          {listening ? "Listening — keep talking" : "Getting that down…"}
        </span>
        {listening && keyLabel && (
          <span style={{ fontSize: 10.5, color: T.ink3, flexShrink: 0 }}>
            release {keyLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {lastTranscript && (
        <div
          style={{
            fontSize: 11,
            color: T.ink3,
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
          gap: 6,
          background: lt(0.05),
          border: `1px solid ${lt(0.12)}`,
          borderRadius: 13,
          padding: "5px 6px 5px 14px",
        }}
      >
        <input
          type="text"
          value={value}
          placeholder={PLACEHOLDER}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: "none",
            background: "transparent",
            color: T.ink,
            fontSize: 13.5,
            fontFamily: "inherit",
          }}
        />

        <button
          type="button"
          className="sl-ctrl"
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
            width: 32,
            height: 32,
            border: 0,
            borderRadius: 9,
            cursor: "pointer",
            background: "transparent",
            color: T.ink2,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <MicIcon />
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={!hasValue}
          title={isThinking ? "Send — it'll pick this up next" : "Send"}
          style={{
            width: 32,
            height: 32,
            border: 0,
            borderRadius: 9,
            background: hasValue
              ? `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`
              : lt(0.06),
            color: hasValue ? T.onAccent : T.ink3,
            display: "grid",
            placeItems: "center",
            cursor: hasValue ? "pointer" : "default",
            opacity: hasValue ? 1 : 0.5,
            boxShadow: hasValue ? `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}` : "none",
            transition: "all 150ms",
            flexShrink: 0,
          }}
        >
          <ISend c={hasValue ? T.onAccent : T.ink3} />
        </button>
      </div>
    </div>
  );
}

function ListeningBars() {
  const T = useTheme();
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
            background: T.accentDeep,
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
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
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
