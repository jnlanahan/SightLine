import type { TokenUsage } from "./usage";
import type { MemoryKind } from "./db/schema";

/**
 * How the coach is helping right now. "guide" walks the user through one step
 * at a time and speaks when a step is done; "watch" stays silent while they
 * work and speaks only when asked. The coach picks and can switch mid-chat;
 * the renderer picks the loop cadence to match.
 */
export type Stance = "guide" | "watch";

/**
 * When an agent wants to be ticked. Declared by the agent (electron/agents/),
 * executed by the renderer's loop (src/hooks/useSessionLoop.ts) — the agent
 * owns the cadence, shared infrastructure owns the scheduler.
 *
 * Crosses the IPC bridge via `agent:describe`, so it lives here with the other
 * shared types rather than in the harness.
 */
export interface LoopPolicy {
  /** Minimum time between model calls, stamped when the call is made. */
  minCallSpacingMs: number;
  /** Backstop auto-poll interval. */
  normalIntervalMs: number;
  /** Backstop once the screen has been still a long time. */
  slowIntervalMs: number;
  /** Silence after last input before triggering a tick. 0 = disabled. */
  quietPeriodMs: number;
  /** Whether ticks may proceed with no screen change so the agent can check in. */
  stallEnabled: boolean;
  /**
   * Skip the call unless the screen changed or a follow-up is pending. True
   * for both coach stances; false is still understood by the loop gate.
   */
  requireScreenChange: boolean;
}

/** What `agent:describe` returns — everything the renderer needs to run a loop. */
export interface AgentDescriptor {
  id: string;
  loop: LoopPolicy;
  /** Per-stance cadence, for an agent that has stances. Falls back to `loop`. */
  loopByStance?: Record<Stance, LoopPolicy>;
  skills: string[];
  tools: string[];
}

/** A durable fact the agent asked to remember beyond this session. */
export interface RememberedFact {
  kind: MemoryKind;
  content: string;
  // The coach read it on screen, rather than being told or assuming it.
  seen: boolean;
}

export type SessionStatus =
  | "idle"
  | "watching"
  | "thinking"
  | "waiting"
  | "paused"
  | "error";

export interface CompletedStep {
  index: number;
  description: string;
  timestamp: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  // Copyable code/command text that accompanied a spoken instruction. Shown
  // as a monospace block, never spoken.
  code?: string;
  timestamp: number;
  // Where the chat stood when the turn was added, so the phase-chat screen can
  // put each message under its step. Set by the store's appendTurn; absent on
  // turns from chats saved before the redesign (those are placed by time).
  // `stage` is the 0-based stage index; `step` the global, 1-based number of
  // the step in progress (step log length + 1).
  stage?: number;
  step?: number;
}

export interface CaptureFrame {
  // base64-encoded image data URL (JPEG), kept in-memory only
  dataUrl: string;
  timestamp: number;
  width: number;
  height: number;
}

// A sub-region of a display to capture, in display-relative DIP coordinates
// (origin at the display's top-left). null means capture the whole display.
export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Pacing decision Claude makes each look. A reply that names no action
// defaults to "instruct" (or "done" when done=true).
export type InstructionAction =
  | "instruct"
  | "wait"
  | "acknowledge"
  | "check_in"
  | "done"
  // The coach said the goal back and is waiting for the user's yes.
  | "confirm_goal";

// How long the current step should take a careful beginner — scales the
// stall check-in timer in the session loop.
export type StepPace = "quick" | "medium" | "long";

// Bounding box of the on-screen element the user should click, as fractions
// (0-1) of the latest screenshot's width/height. Flashed as a glow box on
// the real screen so the user can find the target.
export interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InstructionResponse {
  action: InstructionAction;
  expectedPace: StepPace;
  instruction: string;
  // Code, a command, or file contents the user should paste — shown in the
  // panel as a copyable block with line breaks intact, never read aloud.
  // Empty on most turns.
  code: string;
  // Visible outcome the agent expects this step to produce (verify skill).
  // Empty for non-instruct actions.
  expectedResult: string;
  // True while the agent is diagnosing/fixing a visible failure.
  troubleshooting: boolean;
  completedSteps: string[];
  upcomingSteps: string[];
  digression: boolean;
  // The stance the coach asked to be in from now on. Null/absent = unchanged.
  stance?: Stance | null;
  // The goal as the coach said it back, and what done will look like. Only
  // on a confirm_goal turn; empty or absent otherwise.
  proposedGoal?: string;
  doneWhen?: string;
  // A long goal's stage titles, when the coach laid them out or changed them
  // this turn, and the stage the user is now on (counting from 1).
  // Null/absent = unchanged.
  stages?: string[] | null;
  stageNumber?: number | null;
  done: boolean;
  notes: string;
  // The note records something the coach read on screen this turn.
  noteSeen: boolean;
  highlight: HighlightRect | null;
  // A fact worth carrying into FUTURE sessions, distinct from "notes" (which
  // is a scratchpad for this session only). Null on most turns.
  remember: RememberedFact | null;
  // Mid-turn tools the agent called before ending its turn, in call order.
  // Diagnostic only — the effects have already been applied.
  toolsUsed?: string[];
  // Token accounting for this call. Attached by claude.ts after parsing (the
  // parser itself stays pure); absent when the call never reached the API.
  usage?: TokenUsage;
  model?: string;
  costUsd?: number;
}

export interface UploadedContext {
  name: string;
  text: string;
}

export type TtsVoiceId =
  | "alloy"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "shimmer"
  | "coral"
  | "sage";

// Which speech provider to try first. "auto" uses the quality/latency order
// (ElevenLabs → Google → OpenAI); an explicit choice pins the first provider
// but never removes the fallbacks behind it.
export type TtsProviderChoice = "auto" | "elevenlabs" | "google" | "openai";

// One selectable ElevenLabs voice, as shown in Settings. Fetched live from the
// account when a key is present, with a curated preset list as the fallback.
export interface ElevenVoiceOption {
  id: string;
  name: string;
  blurb: string;
}

export type AccentName = "lime" | "cobalt" | "rose" | "slate";

// The redesign's colour sets (src/design/tokens.ts holds their colours). They
// replace the four accents; an old `accentColor` is read once and mapped.
export type PaletteName = "graphite" | "porcelain" | "midnight";

// Side of the monitor the docked sidebar reserves (Windows AppBar).
export type DockSide = "left" | "right";

export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockState {
  docked: boolean;
  // Reserved strip in screen DIP coordinates (same space as display.bounds);
  // null while floating.
  rect: DockRect | null;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  // Which model the coach runs on. "sonnet" is the faster, cheaper default;
  // "opus" is the stronger one, at about twice the cost per look.
  coachModel: "sonnet" | "opus";
  opacity: number;
  selectedDisplayId: string | null;
  // Pin capture to a specific desktopCapturer source. When set, capture uses
  // this source directly (by id, then by name) instead of trusting the
  // display-to-source matching ladder — the user picked it by thumbnail.
  selectedSourceId: string | null;
  selectedSourceName: string | null;
  captureRegion: CaptureRegion | null;
  hasSeenPrivacyNotice: boolean;
  ttsEnabled: boolean;
  ttsVoice: TtsVoiceId;
  // Preferred speech provider; fallbacks always remain behind it.
  ttsProvider: TtsProviderChoice;
  // ElevenLabs voice id (separate from ttsVoice, which addresses the
  // Google/OpenAI voice sets — the two vendors share no voice namespace).
  elevenVoiceId: string;
  // Speaking rate, 0.7–1.2. Applied when the audio is played (useTts.ts), so
  // it works the same whichever provider spoke.
  ttsSpeed: number;
  // Hold-to-talk: press and hold this key to interrupt the coach and speak.
  // Stored as a uiohook key name (see electron/hotkey.ts).
  pushToTalkKey: PushToTalkKey;
  // Whether holding the push-to-talk key cuts off in-progress speech.
  bargeInEnabled: boolean;
  // Soft budget for a single session, in USD. The coach warns as it nears the
  // cap and stops making paid calls at it. 0 disables the cap.
  sessionBudgetUsd: number;
  // Let the coach recall durable facts from earlier sessions.
  memoryEnabled: boolean;
  // Colour set for the whole app and the glow overlay.
  palette: PaletteName;
  // Retired: read once from old settings files to choose `palette`, then
  // dropped. Never written. (Removed from the type in WP8.)
  accentColor?: AccentName;
  windowBounds: WindowBounds | null;
  solidBackground: boolean;
  // One-time migration flag: forces opacity/solidBackground to opaque once
  // for settings saved before the opaque-by-default change.
  uiOpaqueMigration: boolean;
  // One-time migration flag: widens the saved window once for the side-rail
  // layout (plan steps now live in a right-hand column that needs room).
  uiSideRailMigration: boolean;
  // One-time migration flag: captureRegion is stored display-relative now
  // (it used to be relative to the glow window, which moves with the dock).
  captureRegionDisplayRelative: boolean;
  // Coach Mode: dock the panel to the side of the watched monitor during
  // sessions (Windows AppBar — the OS reserves the strip).
  dockEnabled: boolean;
  dockSide: DockSide;
  dockWidth: number;
}

export interface DisplayInfo {
  id: string;
  label: string;
  primary: boolean;
  width: number;
  height: number;
}

// A selectable capture target: one desktopCapturer screen source, paired with
// its display when identifiable. The thumbnail lets the user pick by looking
// at actual screen content — display IDs on Windows are not reliable enough
// to trust blindly.
export interface CaptureTarget {
  sourceId: string;
  sourceName: string;
  displayId: string | null;
  label: string;
  primary: boolean;
  thumbnailDataUrl: string;
  width: number;
  height: number;
}

export interface ApiKeyStatus {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
  elevenlabs: boolean;
}

// Which engine actually produced the audio for a tts:speak call.
export type TtsEngine = "elevenlabs" | "google" | "openai";

// What actually spoke, including the two non-cloud outcomes: the browser's
// built-in voice, and nothing at all. Surfaced in the UI so a silent
// degradation to the robotic system voice is visible rather than mysterious.
export type TtsPlaybackEngine = TtsEngine | "system" | "none";

// Keys offered for hold-to-talk. Deliberately a short list of keys that are
// unlikely to collide with what the user is typing in the app they're being
// coached through.
export type PushToTalkKey = "ctrl" | "alt" | "f8" | "f9" | "none";
