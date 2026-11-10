import { useState } from "react";
import { useVoice } from "../hooks/useVoice";
import { markAsk } from "../lib/askClock";
import { useTheme } from "../design/ThemeProvider";
import { Eyebrow } from "../design/primitives";
import { ar, lt } from "../design/theme";
import { ScreenPicker } from "./ScreenPicker";

interface Props {
  onStart(goal: string): void;
}

/**
 * The one front door: say what you want and the coach starts. No mode to
 * pick and no setup questions — the coach's first look at the goal and the
 * screen decides how to help.
 */
export function Home({ onStart }: Props) {
  const T = useTheme();
  const [value, setValue] = useState("");

  const voice = useVoice((text) =>
    setValue((prev) => (prev ? `${prev} ${text}` : text)),
  );

  function start() {
    const goal = value.trim();
    if (!goal) return;
    markAsk("goal", Date.now());
    onStart(goal);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Multi-monitor: pick the watched screen right here, in the flow —
          most users never open Settings. Renders nothing on single-screen. */}
      <ScreenPicker compact />

      <Eyebrow>What do you want to do?</Eyebrow>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            start();
          }
        }}
        rows={3}
        autoFocus
        placeholder={'e.g. "How do I freeze the top row?" or "Teach me pivot tables in Excel"'}
        className="sl-scroll no-drag"
        style={{
          width: "100%", border: `1px solid ${lt(0.10)}`,
          background: lt(0.04), borderRadius: 11,
          padding: "9px 12px", fontSize: 13.5, color: T.ink,
          outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          resize: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => (voice.state === "recording" ? voice.stop() : voice.start())}
          disabled={voice.state === "transcribing"}
          style={{
            borderRadius: 9, border: `1px solid ${lt(0.10)}`,
            background: voice.state === "recording" ? "rgba(239,68,68,0.12)" : lt(0.04),
            color: voice.state === "recording" ? "#ef4444" : T.ink2,
            fontSize: 12, fontWeight: 500, padding: "7px 14px",
            cursor: voice.state === "transcribing" ? "default" : "pointer",
            opacity: voice.state === "transcribing" ? 0.5 : 1,
          }}
        >
          {voice.state === "recording"
            ? "● Stop"
            : voice.state === "transcribing"
              ? "Transcribing…"
              : "🎤 Speak"}
        </button>
        <button
          type="button"
          onClick={start}
          disabled={value.trim().length === 0}
          style={{
            marginLeft: "auto", borderRadius: 9, border: 0,
            background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
            color: T.onAccent,
            fontSize: 12, fontWeight: 600, padding: "7px 20px",
            cursor: "pointer",
            opacity: value.trim().length === 0 ? 0.4 : 1,
            boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
            transition: "opacity 150ms",
          }}
        >
          Start
        </button>
      </div>
      {voice.error && (
        <p style={{ fontSize: 11, color: "#ef4444", margin: 0 }}>{voice.error}</p>
      )}
    </div>
  );
}
