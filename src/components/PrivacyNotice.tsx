import { useTheme } from "../design/ThemeProvider";
import { api } from "../lib/api";
import { ar, lt } from "../design/theme";

interface Props {
  onAccept(): void;
}

export function PrivacyNotice({ onAccept }: Props) {
  const T = useTheme();
  return (
    <div style={{ display: "flex", height: "100%", flexDirection: "column", gap: 16, padding: 20 }}>
      <div>
        <p style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: T.ink3 }}>
          Before we begin
        </p>
        <h2 style={{ margin: "6px 0 0", fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em", color: T.ink }}>
          SightLine will watch your screen
        </h2>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          <>Screenshots are sent to the <strong style={{ color: T.ink, fontWeight: 600 }}>Anthropic API</strong> to get your next instruction.</>,
          <>Screenshots are kept in memory only — <strong style={{ color: T.ink, fontWeight: 600 }}>never written to disk</strong>.</>,
          <>Voice input is sent to the <strong style={{ color: T.ink, fontWeight: 600 }}>OpenAI Whisper API</strong> for transcription.</>,
          <>Hit <strong style={{ color: T.ink, fontWeight: 600 }}>Pause</strong> or <strong style={{ color: T.ink, fontWeight: 600 }}>Stop</strong> at any time to halt capture and API calls.</>,
          <>API keys are stored <strong style={{ color: T.ink, fontWeight: 600 }}>encrypted on this PC</strong>.</>,
        ].map((item, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span
              style={{
                marginTop: 3, width: 6, height: 6, flexShrink: 0,
                borderRadius: "50%", background: T.accent,
              }}
            />
            <span style={{ fontSize: 12, lineHeight: 1.55, color: T.ink2 }}>{item}</span>
          </li>
        ))}
      </ul>
      <p
        style={{
          margin: 0, borderRadius: 11, padding: "11px 14px",
          fontSize: 11, lineHeight: 1.5, color: T.ink3,
          border: `1px solid ${lt(0.06)}`, background: lt(0.02),
        }}
      >
        Avoid having passwords or sensitive data on screen unless you trust the recipient API.
      </p>
      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => void api().app.quit()}
          style={{
            borderRadius: 9, padding: "7px 14px",
            fontSize: 11.5, fontWeight: 500,
            background: "transparent", color: T.ink3,
            border: `1px solid ${lt(0.1)}`, cursor: "pointer",
          }}
        >
          Quit
        </button>
        <button
          onClick={onAccept}
          style={{
            borderRadius: 11, padding: "9px 22px",
            fontSize: 12.5, fontWeight: 600,
            background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
            color: T.onAccent, border: 0, cursor: "pointer",
            boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
            transition: "opacity 150ms",
          }}
        >
          I understand, continue
        </button>
      </div>
    </div>
  );
}
