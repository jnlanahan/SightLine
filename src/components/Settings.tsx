import { useEffect, useState } from "react";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import { DEFAULT_PALETTE, PALETTES } from "../design/tokens";
import type {
  ElevenVoiceOption,
  PaletteName,
  PushToTalkKey,
  TtsPlaybackEngine,
  TtsProviderChoice,
  TtsVoiceId,
} from "../lib/api";
import type { MemoryFact } from "../../electron/db/schema";
import { useTts, getTtsMode } from "../hooks/useTts";
import { ScreenPicker } from "./ScreenPicker";
import { SeenMark } from "./AboutChat";

const PALETTE_OPTIONS: PaletteName[] = ["graphite", "porcelain", "midnight"];

const VOICE_OPTIONS: { id: TtsVoiceId; label: string; sample: string }[] = [
  { id: "nova",    label: "Ava — warm female (recommended)", sample: "Hey, I'm Ava. Ready when you are." },
  { id: "shimmer", label: "Iris — calm female",              sample: "Hi there — let's walk through this together." },
  { id: "onyx",    label: "Charlie — natural male (recommended)", sample: "Alright. Let's take it one step at a time." },
  { id: "echo",    label: "Puck — natural male",                sample: "Hey, let me know when you're ready to go." },
];

interface Props {
  onClose(): void;
}

export function Settings({ onClose }: Props) {
  const T        = useTheme();
  const settings  = useSettings((s) => s.settings);
  const keyStatus = useSettings((s) => s.keyStatus);
  const patch     = useSettings((s) => s.patch);

  if (!settings) return null;

  const sectionLabel: React.CSSProperties = {
    fontFamily: "ui-monospace, monospace",
    fontSize: 10, color: T.ink3,
    letterSpacing: "0.08em", textTransform: "uppercase" as const,
    fontWeight: 600,
  };

  const selectStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px",
    background: lt(0.04), color: T.ink,
    border: `1px solid ${lt(0.10)}`,
    borderRadius: 10, fontSize: 12.5,
    fontFamily: "inherit", outline: "none",
    cursor: "pointer", appearance: "none" as const,
  };

  const accentBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "7px 0",
    borderRadius: 9,
    border: active ? `1px solid ${ar(T.accentRGB, 0.7)}` : `1px solid ${lt(0.08)}`,
    background: active ? ar(T.accentRGB, 0.16) : lt(0.04),
    color: active ? T.accentText : T.ink2,
    fontSize: 12, fontWeight: active ? 600 : 400,
    cursor: "pointer", fontFamily: "inherit",
    transition: "all 140ms",
  });

  const actionBtnStyle: React.CSSProperties = {
    borderRadius: 9,
    background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
    color: T.onAccent,
    fontSize: 12, fontWeight: 600,
    padding: "7px 14px", border: 0,
    cursor: "pointer", whiteSpace: "nowrap",
    fontFamily: "inherit", flexShrink: 0,
    boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
  };

  const ghostBtnStyle: React.CSSProperties = {
    borderRadius: 9,
    border: `1px solid ${lt(0.08)}`,
    background: "transparent",
    color: T.ink2,
    fontSize: 12, fontWeight: 500,
    padding: "7px 14px",
    cursor: "pointer", whiteSpace: "nowrap",
    fontFamily: "inherit", flexShrink: 0,
  };

  return (
    <div
      className="sl-sheet-in"
      style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        background: T.surface,
        fontFamily: "ui-sans-serif, system-ui, Segoe UI, sans-serif",
        borderRadius: 22,
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px",
        borderBottom: `1px solid ${lt(0.08)}`,
        flexShrink: 0,
      }}>
        <button
          type="button"
          onClick={onClose}
          className="sl-ctrl"
          style={{ width: 30, height: 30, border: 0, borderRadius: 9, background: "transparent", color: T.ink2, display: "grid", placeItems: "center", cursor: "pointer" }}
          title="Back"
        >
          <BackArrowIcon c={T.ink2} />
        </button>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.ink, letterSpacing: "-0.01em" }}>
          Settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="sl-ctrl"
          style={{ marginLeft: "auto", width: 30, height: 30, border: 0, borderRadius: 9, background: "transparent", color: T.ink2, display: "grid", placeItems: "center", cursor: "pointer" }}
          title="Close"
        >
          <CloseXIcon c={T.ink2} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="sl-scroll" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20, padding: "16px 16px 20px" }}>

        {/* Starting a chat with no Anthropic key lands here, so say where it goes. */}
        {!keyStatus.anthropic && (
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: T.warn }}>
            SightLine needs an Anthropic API key to start. Put <code>ANTHROPIC_API_KEY</code> in
            the .env file, then restart SightLine.
          </p>
        )}

        {/* Capture */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Capture</span>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>Which screen should I watch?</span>
            <p style={{ fontSize: 10, color: T.ink3, margin: 0, lineHeight: 1.5 }}>
              Pick the screen you'll be working on — these previews show exactly what the AI will see.
            </p>
            <ScreenPicker />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>Capture area</span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink3 }}>
                {settings.captureRegion
                  ? `${settings.captureRegion.width}×${settings.captureRegion.height} region`
                  : "full display"}
              </span>
            </div>
            <p style={{ fontSize: 10, color: T.ink3, margin: 0, lineHeight: 1.5 }}>
              Click <strong>Adjust</strong> → drag the purple box handles → click <strong>Done</strong> to set a capture zone.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => { void api().overlay.setAdjust(true); onClose(); }}
                style={actionBtnStyle}
              >
                Adjust
              </button>
              {settings.captureRegion && (
                <button
                  type="button"
                  onClick={() => void patch({ captureRegion: null })}
                  style={ghostBtnStyle}
                >
                  Reset to full display
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Appearance</span>

          {/* Colours (redesign SPEC §9): a segmented control. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span id="sl-colours-label" style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>Colours</span>
            <div
              className="no-drag"
              role="radiogroup"
              aria-labelledby="sl-colours-label"
              style={{ display: "flex", gap: 2, padding: 3, borderRadius: 10, background: lt(0.08) }}
            >
              {PALETTE_OPTIONS.map((name) => {
                const opt = PALETTES[name];
                const active = (settings.palette ?? DEFAULT_PALETTE) === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className="sl-focus"
                    onClick={() => void patch({ palette: name })}
                    style={{
                      flex: 1, height: 32, border: 0, borderRadius: 8,
                      background: active ? T.accent : "transparent",
                      color: active ? T.onAccent : T.ink,
                      fontSize: 12.5, fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      transition: "background 140ms",
                    }}
                  >
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: opt.bg, border: `2px solid ${opt.accent}` }} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Idle opacity */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>Idle opacity</span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink3 }}>
                {Math.round(settings.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={30} max={100} step={1}
              value={Math.round(settings.opacity * 100)}
              onChange={(e) => void patch({ opacity: Number(e.target.value) / 100 })}
              className="no-drag"
              style={{ width: "100%", accentColor: T.accent }}
              title="Idle opacity"
            />
            <span style={{ fontSize: 10, color: T.ink3 }}>
              How visible the panel stays while you work in other apps
            </span>
          </div>

          {/* Solid background */}
          <ToggleRow
            T={T}
            label="Solid background"
            hint="Removes the glass/blur effect for better readability"
            checked={settings.solidBackground ?? false}
            onChange={(v) => patch({ solidBackground: v })}
            accentRGB={T.accentRGB}
            accent={T.accent}
          />
        </div>

        {/* Docking */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Docking</span>
          <ToggleRow
            T={T}
            label="Dock to the side"
            hint="Reserves a strip of the watched monitor — your other windows resize to fit beside the coach"
            checked={settings.dockEnabled}
            onChange={(v) => patch({ dockEnabled: v })}
            accentRGB={T.accentRGB}
            accent={T.accent}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink, opacity: settings.dockEnabled ? 1 : 0.4 }}>
              Dock side
            </span>
            <div className="no-drag" style={{ display: "flex", gap: 6, opacity: settings.dockEnabled ? 1 : 0.4 }}>
              {(["left", "right"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  disabled={!settings.dockEnabled}
                  onClick={() => void patch({ dockSide: side })}
                  style={accentBtnStyle(settings.dockSide === side)}
                >
                  {side === "left" ? "Left" : "Right"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Voice */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Voice</span>
          <ToggleRow
            T={T}
            label="Read instructions aloud"
            hint={
              keyStatus.elevenlabs
                ? "Using ElevenLabs natural voice"
                : keyStatus.google
                  ? "Using Google natural voice"
                  : keyStatus.openai
                    ? "Using OpenAI voice"
                    : "Using system voice"
            }
            checked={settings.ttsEnabled}
            onChange={(v) => patch({ ttsEnabled: v })}
            accentRGB={T.accentRGB}
            accent={T.accent}
          />
          <VoicePicker
            disabled={
              !settings.ttsEnabled ||
              (!keyStatus.openai && !keyStatus.google && !keyStatus.elevenlabs)
            }
            selectStyle={selectStyle}
            ghostBtnStyle={ghostBtnStyle}
          />
        </div>

        {/* Talking back */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Talking back</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>
                Hold-to-talk key
              </span>
              <span style={{ marginTop: 2, fontSize: 10, color: T.ink3 }}>
                Hold it anywhere — even in another app — to interrupt and speak
              </span>
            </div>
            <select
              value={settings.pushToTalkKey}
              onChange={(e) =>
                void patch({ pushToTalkKey: e.target.value as PushToTalkKey })
              }
              style={{ ...selectStyle, width: 110, flexShrink: 0 }}
            >
              <option value="f9">F9</option>
              <option value="f8">F8</option>
              <option value="ctrl">Ctrl</option>
              <option value="alt">Alt</option>
              <option value="none">Off</option>
            </select>
          </div>
          <ToggleRow
            T={T}
            label="Interrupt when I start talking"
            hint="The coach stops mid-sentence the moment you hold the key, like a person would"
            checked={settings.bargeInEnabled}
            onChange={(v) => void patch({ bargeInEnabled: v })}
            accentRGB={T.accentRGB}
            accent={T.accent}
          />
          {!keyStatus.openai && (
            <p style={{ margin: 0, fontSize: 10, color: T.ink3 }}>
              Speaking needs an OpenAI key for transcription. Put <code>OPENAI_API_KEY</code> in
              the .env file, then restart SightLine.
            </p>
          )}
        </div>

        {/* Memory */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Memory</span>
          <ToggleRow
            T={T}
            label="Remember me between sessions"
            hint="Durable facts only — your setup and preferences, never passwords or personal details"
            checked={settings.memoryEnabled}
            onChange={(v) => void patch({ memoryEnabled: v })}
            accentRGB={T.accentRGB}
            accent={T.accent}
          />
          <MemoryList ghostBtnStyle={ghostBtnStyle} />
        </div>

        {/* Coach */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Coach</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>
                Model
              </span>
              <span style={{ marginTop: 2, fontSize: 10, color: T.ink3 }}>
                Sonnet is the everyday choice. Opus is stronger on hard problems and costs about twice as much per look. Takes effect on the next look.
              </span>
            </div>
            <select
              value={settings.coachModel === "opus" ? "opus" : "sonnet"}
              onChange={(e) =>
                void patch({ coachModel: e.target.value === "opus" ? "opus" : "sonnet" })
              }
              style={{ ...selectStyle, width: 130, flexShrink: 0 }}
            >
              <option value="sonnet">Sonnet 5.5</option>
              <option value="opus">Opus 5.5</option>
            </select>
          </div>
        </div>

        {/* Spend */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Spend</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>
                Stop a session at
              </span>
              <span style={{ marginTop: 2, fontSize: 10, color: T.ink3 }}>
                A runaway guard, not a ration. A typical hour costs about $1.
              </span>
            </div>
            <select
              value={String(settings.sessionBudgetUsd)}
              onChange={(e) =>
                void patch({ sessionBudgetUsd: Number(e.target.value) })
              }
              style={{ ...selectStyle, width: 110, flexShrink: 0 }}
            >
              <option value="1">$1</option>
              <option value="3">$3</option>
              <option value="5">$5</option>
              <option value="10">$10</option>
              <option value="0">No limit</option>
            </select>
          </div>
        </div>

        {/* Diagnostics */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={sectionLabel}>Diagnostics</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>Activity log</span>
              <span style={{ marginTop: 2, fontSize: 10, color: T.ink3 }}>
                Records why the coach spoke or stayed quiet — share this file when reporting a problem
              </span>
            </div>
            <button
              type="button"
              onClick={() => void api().app.openLogs()}
              style={ghostBtnStyle}
            >
              Open log file
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 4, textAlign: "center",
          fontFamily: "ui-monospace, monospace",
          fontSize: 10, color: T.ink3,
          letterSpacing: "0.06em", textTransform: "uppercase",
        }}>
          SightLine
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function ToggleRow({
  T,
  label,
  hint,
  checked,
  onChange,
  accentRGB,
  accent,
}: {
  T: ReturnType<typeof useTheme>;
  label: string;
  hint?: string;
  checked: boolean;
  onChange(v: boolean): void;
  accentRGB: string;
  accent: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>{label}</span>
        {hint && <span style={{ marginTop: 2, fontSize: 10, color: T.ink3 }}>{hint}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        style={{
          position: "relative", flexShrink: 0, borderRadius: 999, border: 0,
          width: 34, height: 20,
          background: checked ? ar(accentRGB, 1) : lt(0.18),
          cursor: "pointer", padding: 0,
          transition: "background 180ms",
        }}
      >
        <span
          style={{
            position: "absolute", top: 2, borderRadius: "50%", background: checked ? T.onAccent : T.ink2,
            width: 16, height: 16,
            left: checked ? 14 : 2,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            transition: "left 180ms cubic-bezier(0.3,0,0.2,1)",
          }}
        />
      </button>
    </div>
  );
}

function VoicePicker({
  disabled,
  selectStyle,
  ghostBtnStyle,
}: {
  disabled: boolean;
  selectStyle: React.CSSProperties;
  ghostBtnStyle: React.CSSProperties;
}) {
  const settings = useSettings((s) => s.settings);
  const patch    = useSettings((s) => s.patch);
  const keyStatus = useSettings((s) => s.keyStatus);
  const { speak } = useTts();
  const T = useTheme();
  const [previewResult, setPreviewResult] = useState<
    TtsPlaybackEngine | "pending" | null
  >(null);

  const elevenVoices = useSettings((s) => s.settings?.elevenVoiceId);
  const [voices, setVoices] = useState<ElevenVoiceOption[]>([]);

  // The account's real voice list. Falls back to a curated preset list inside
  // the main process, so this is never empty even with no key.
  useEffect(() => {
    let alive = true;
    void api()
      .tts.listVoices()
      .then((v) => {
        if (alive) setVoices(v);
      })
      .catch(() => {
        /* the picker just stays on presets */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!settings) return null;

  const provider = settings.ttsProvider;
  // ElevenLabs is what's actually used when "auto" resolves, provided a key
  // exists — so its voice list is the relevant one in both cases.
  const usingEleven =
    provider === "elevenlabs" || (provider === "auto" && keyStatus.elevenlabs);

  function handlePreview() {
    setPreviewResult("pending");
    speak(
      "Hey — I'm your coach. I'll watch your screen and walk you through it, one step at a time.",
    );
    window.setTimeout(() => {
      setPreviewResult(getTtsMode() ?? "none");
    }, 3500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <select
        title="Speech provider"
        disabled={disabled}
        value={provider}
        onChange={(e) =>
          void patch({ ttsProvider: e.target.value as TtsProviderChoice })
        }
        style={{ ...selectStyle, opacity: disabled ? 0.4 : 1 }}
      >
        <option value="auto">
          Best available{keyStatus.elevenlabs ? " (ElevenLabs)" : keyStatus.google ? " (Google)" : ""}
        </option>
        <option value="elevenlabs">
          ElevenLabs — most human, fastest{keyStatus.elevenlabs ? "" : " (no key)"}
        </option>
        <option value="google">
          Google Chirp 3{keyStatus.google ? "" : " (no key)"}
        </option>
        <option value="openai">
          OpenAI{keyStatus.openai ? "" : " (no key)"}
        </option>
      </select>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {usingEleven ? (
          <select
            title="Voice"
            disabled={disabled}
            value={elevenVoices}
            onChange={(e) => void patch({ elevenVoiceId: e.target.value })}
            style={{ ...selectStyle, flex: 1, opacity: disabled ? 0.4 : 1 }}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.blurb ? `${v.name} — ${v.blurb}` : v.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            title="Voice"
            disabled={disabled}
            value={settings.ttsVoice}
            onChange={(e) => void patch({ ttsVoice: e.target.value as TtsVoiceId })}
            style={{ ...selectStyle, flex: 1, opacity: disabled ? 0.4 : 1 }}
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handlePreview}
          style={{ ...ghostBtnStyle, display: "inline-flex", alignItems: "center", gap: 5 }}
          title="Hear this voice"
        >
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
            <path d="M1 1l6 4-6 4z" fill={T.ink2} />
          </svg>
          Preview
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: T.ink3, flexShrink: 0 }}>Pace</span>
        <input
          type="range"
          min={0.8}
          max={1.15}
          step={0.05}
          disabled={disabled}
          value={settings.ttsSpeed}
          onChange={(e) => void patch({ ttsSpeed: Number(e.target.value) })}
          style={{ flex: 1, accentColor: T.accent }}
        />
        <span
          style={{
            fontSize: 11,
            color: T.ink3,
            width: 34,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {settings.ttsSpeed.toFixed(2)}×
        </span>
      </div>

      {previewResult === "pending" && (
        <p style={{ fontSize: 10, color: T.ink3, margin: 0 }}>Testing…</p>
      )}
      {previewResult === "elevenlabs" && (
        <p style={{ fontSize: 10, color: T.accentText, margin: 0 }}>✓ ElevenLabs — the good one</p>
      )}
      {previewResult === "google" && (
        <p style={{ fontSize: 10, color: T.accentText, margin: 0 }}>✓ Google Chirp 3 — working</p>
      )}
      {previewResult === "openai" && (
        <p style={{ fontSize: 10, color: T.accentText, margin: 0 }}>✓ OpenAI — working</p>
      )}
      {previewResult === "system" && (
        <p style={{ fontSize: 10, color: T.warn, margin: 0 }}>
          ⚠ Fell back to the robotic system voice — check your keys and network
        </p>
      )}
      {previewResult === "none" && (
        <p style={{ fontSize: 10, color: T.warn, margin: 0 }}>
          ✗ No audio — check audio permissions or your API key
        </p>
      )}
      {!keyStatus.elevenlabs && (
        <p style={{ fontSize: 10, color: T.ink3, margin: 0 }}>
          Add <code>ELEVENLABS_API_KEY</code> to your .env for the most
          human-sounding voice and the fastest response.
        </p>
      )}
    </div>
  );
}

/**
 * About you: what the coach remembers about you across chats. Each fact is
 * marked seen on screen (or confirmed by you) versus not yet confirmed, and
 * can be corrected, confirmed or forgotten. Memory the user can't see,
 * correct or delete is memory they can't trust.
 */
function MemoryList({ ghostBtnStyle }: { ghostBtnStyle: React.CSSProperties }) {
  const T = useTheme();
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api()
      .memory.list()
      .then(setFacts)
      .catch(() => setFacts([]));
  }, [open]);

  async function forget(id: string) {
    await api().memory.forget(id);
    setFacts((prev) => prev?.filter((f) => f.id !== id) ?? null);
  }

  // Only what the main process actually saved is shown, so the list never
  // claims a change that did not land.
  async function update(id: string, change: { content?: string; verified?: true }) {
    const res = await api().memory.update(id, change);
    const saved = res.fact;
    if (res.updated && saved) {
      setFacts((prev) => prev?.map((f) => (f.id === id ? saved : f)) ?? null);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={ghostBtnStyle}>
        Review what it remembers
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {facts === null && (
        <p style={{ fontSize: 11, color: T.ink3, margin: 0 }}>Loading…</p>
      )}
      {facts?.length === 0 && (
        <p style={{ fontSize: 11, color: T.ink3, margin: 0 }}>
          Nothing remembered yet. The coach picks things up as you work.
        </p>
      )}
      {facts?.map((f) => (
        <FactRow
          key={f.id}
          fact={f}
          onForget={() => void forget(f.id)}
          onEdit={(content) => void update(f.id, { content })}
          onConfirm={() => void update(f.id, { verified: true })}
        />
      ))}
      <button type="button" onClick={() => setOpen(false)} style={ghostBtnStyle}>
        Done
      </button>
    </div>
  );
}

function FactRow({
  fact,
  onForget,
  onEdit,
  onConfirm,
}: {
  fact: MemoryFact;
  onForget(): void;
  onEdit(content: string): void;
  onConfirm(): void;
}) {
  const T = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.content);
  const verified = fact.verified === true;
  const linkBtn: React.CSSProperties = {
    border: 0, background: "transparent", padding: 0, cursor: "pointer",
    fontSize: 10.5, color: T.ink3, fontFamily: "inherit",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 10px",
        borderRadius: 9,
        background: lt(0.04),
        border: `1px solid ${lt(0.07)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: T.ink3,
            flexShrink: 0,
            marginTop: 2,
            width: 62,
          }}
        >
          {fact.kind}
        </span>
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={200}
            autoFocus
            style={{
              flex: 1, resize: "vertical", fontSize: 11.5, lineHeight: 1.45,
              fontFamily: "inherit", color: T.ink, background: "transparent",
              border: `1px solid ${lt(0.12)}`, borderRadius: 6, padding: "4px 6px",
            }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 11.5, lineHeight: 1.45, color: T.ink2 }}>
            {fact.content}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 70 }}>
        <SeenMark
          seen={verified}
          seenLabel="Seen or confirmed"
          seenTitle="The coach read this on your screen, or you confirmed it"
        />
        <span style={{ flex: 1 }} />
        {editing ? (
          <>
            <button
              type="button"
              style={{ ...linkBtn, color: T.accentText }}
              onClick={() => {
                if (draft.trim()) onEdit(draft);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              type="button"
              style={linkBtn}
              onClick={() => {
                setDraft(fact.content);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!verified && (
              <button type="button" style={linkBtn} onClick={onConfirm} title="This is right">
                Confirm
              </button>
            )}
            <button
              type="button"
              style={linkBtn}
              onClick={() => {
                setDraft(fact.content);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button type="button" style={linkBtn} onClick={onForget} title="Forget this">
              Forget
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Icons ── */
function BackArrowIcon({ c }: { c?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9 2L4 7l5 5" stroke={c || "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CloseXIcon({ c }: { c?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke={c || "currentColor"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
