import { useEffect, useState } from "react";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import type { CaptureTarget } from "../lib/api";

// Choose the watched screen by looking at live thumbnails — the only method
// that can't be fooled by Windows' unreliable display IDs. Selecting a tile
// pins capture to that exact source; the glow overlay follows via the
// pixel-verified calibration map.
export function ScreenPicker({ compact = false }: { compact?: boolean }) {
  const T = useTheme();
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const [targets, setTargets] = useState<CaptureTarget[]>([]);
  const [recalibrating, setRecalibrating] = useState(false);

  const refresh = () => void api().capture.listTargets().then(setTargets);
  useEffect(() => {
    refresh();
    // Thumbnails go stale — refresh them while the full picker (Settings) is
    // visible. Each refresh is a thumbnail grab of every display plus a JPEG
    // encode, so the compact goal-screen variant fetches once: on a single
    // monitor it renders nothing at all, and the interval was still running
    // the whole time the user typed their goal.
    if (compact) return;
    const timer = window.setInterval(refresh, 4_000);
    return () => window.clearInterval(timer);
  }, [compact]);

  if (!settings) return null;
  // In compact mode (goal screen) only show when there's a real choice.
  if (compact && targets.length < 2) return null;

  const isSelected = (t: CaptureTarget) => {
    if (settings.selectedSourceId || settings.selectedSourceName) {
      return (
        t.sourceId === settings.selectedSourceId ||
        t.sourceName === settings.selectedSourceName
      );
    }
    if (settings.selectedDisplayId) return t.displayId === settings.selectedDisplayId;
    return t.primary;
  };

  async function recalibrate() {
    setRecalibrating(true);
    try {
      await api().capture.recalibrate();
      refresh();
    } finally {
      setRecalibrating(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {compact && (
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.13em",
          textTransform: "uppercase", color: T.ink3,
        }}>
          Which screen will you be working on?
        </span>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {targets.map((t) => {
          const active = isSelected(t);
          return (
            <button
              key={t.sourceId}
              type="button"
              onClick={() =>
                void patch({
                  selectedDisplayId: t.displayId,
                  selectedSourceId: t.sourceId,
                  selectedSourceName: t.sourceName,
                })
              }
              style={{
                flex: "1 1 130px", maxWidth: compact ? 190 : 220, padding: 0,
                borderRadius: 11, overflow: "hidden", cursor: "pointer",
                border: active ? `2px solid ${T.accent}` : `1px solid ${lt(0.12)}`,
                background: lt(0.04),
                display: "flex", flexDirection: "column",
                boxShadow: active ? `0 0 0 3px ${ar(T.accentRGB, 0.18)}` : "none",
                transition: "all 140ms",
              }}
            >
              <img
                src={t.thumbnailDataUrl}
                alt={t.label}
                style={{ width: "100%", aspectRatio: "16/10", objectFit: "cover", display: "block" }}
              />
              <span style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 8px", fontSize: 10.5,
                color: active ? T.accentText : T.ink2,
                fontWeight: active ? 700 : 500,
              }}>
                {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accentDeep, flexShrink: 0 }} />}
                {active ? "Watching this screen" : t.label}
                {t.primary && !active ? " (primary)" : ""}
              </span>
            </button>
          );
        })}
        {targets.length === 0 && !compact && (
          <p style={{ fontSize: 11, color: T.ink3, margin: 0 }}>Looking for screens…</p>
        )}
      </div>
      {!compact && (
        <button
          type="button"
          onClick={() => void recalibrate()}
          disabled={recalibrating}
          style={{
            alignSelf: "flex-start",
            borderRadius: 8, border: `1px solid ${lt(0.1)}`,
            background: "transparent", color: T.ink3,
            fontSize: 10.5, padding: "4px 10px", cursor: "pointer",
            opacity: recalibrating ? 0.5 : 1,
          }}
          title="Re-check which capture source belongs to which monitor — your screens will flash briefly"
        >
          {recalibrating ? "Recalibrating…" : "Recalibrate screens (screens flash briefly)"}
        </button>
      )}
    </div>
  );
}
