import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Settings } from "./types";
import { DEFAULT_ELEVEN_VOICE_ID } from "./tts/shared";
import { logLine } from "./log";

const DEFAULTS: Settings = {
  captureIntervalSec: 5,
  opacity: 1,
  selectedDisplayId: null,
  selectedSourceId: null,
  selectedSourceName: null,
  captureRegion: null,
  hasSeenPrivacyNotice: false,
  ttsEnabled: true,
  ttsVoice: "nova",
  ttsProvider: "auto",
  elevenVoiceId: DEFAULT_ELEVEN_VOICE_ID,
  ttsSpeed: 1.0,
  // F9, not a modifier: the user is typing in someone else's app while this
  // hook is live, so a PTT key that fires on Ctrl+C would be unusable.
  pushToTalkKey: "f9",
  bargeInEnabled: true,
  // Generous by design: the loop's own spacing rules are the real cost
  // control, and a cap that trips mid-task is worse than no cap. This exists
  // to catch a runaway, not to ration normal use.
  sessionBudgetUsd: 3.0,
  historyEnabled: true,
  memoryEnabled: true,
  accentColor: "lime",
  windowBounds: null,
  solidBackground: true,
  uiOpaqueMigration: false,
  uiSideRailMigration: false,
  captureRegionDisplayRelative: false,
  dockEnabled: true,
  dockSide: "left",
  dockWidth: 400,
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

// Voice ids that shipped as a default but turned out to be unusable on some
// plans, mapped to nothing — anyone still pointing at one gets moved to the
// current default. Without this, a user who ran an earlier build keeps the bad
// id in settings.json forever and sees an empty voice dropdown.
const RETIRED_VOICE_IDS = new Set([
  // Rachel — a Voice Library voice, which free plans cannot use via the API.
  "21m00Tcm4TlvDq8ikWAM",
  // Charlotte — same.
  "XB0fDUnXU5powFXDhCwa",
]);

// The parsed file, once read. Settings are consulted on hot paths — every
// global key press (for the push-to-talk key), every capture, every TTS
// sentence — and each of those used to be a synchronous disk read plus a
// JSON parse on the main thread. This process is the only writer, so the
// in-memory copy is always current once saveSettings keeps it in sync.
let cache: Settings | null = null;

function readFromDisk(): Settings {
  let parsed: Partial<Settings> = {};
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    parsed = JSON.parse(raw) as Partial<Settings>;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    // A missing file is the normal first run. Anything else — a corrupt file
    // after a crash mid-write, a hand edit gone wrong — used to silently
    // become defaults, which reads as "my settings vanished".
    if (code !== "ENOENT") {
      logLine(
        `[settings] could not read settings.json, using defaults: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const merged = { ...DEFAULTS, ...parsed };
  if (RETIRED_VOICE_IDS.has(merged.elevenVoiceId)) {
    merged.elevenVoiceId = DEFAULTS.elevenVoiceId;
  }
  return merged;
}

export function loadSettings(): Settings {
  if (!cache) cache = readFromDisk();
  // Callers receive a copy so a mutation can never leak into the cache.
  return { ...cache };
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...next };
  cache = merged;
  try {
    const file = settingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename so a crash mid-write leaves the previous good file
    // rather than a truncated one.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf-8");
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error("[settings] failed to write:", err);
  }
  return merged;
}
