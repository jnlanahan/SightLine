// Pure helpers shared by the TTS providers. No Electron, no network, no fs —
// so the renderer test suite can import this directly.

export type TtsProviderName = "elevenlabs" | "google" | "openai" | "system";

/** One synthesis request, fully described. Doubles as the cache key input. */
export interface SynthRequest {
  text: string;
  provider: TtsProviderName;
  voice: string;
  model: string;
  speed: number;
  /**
   * What the coach already said earlier in this same response.
   *
   * The coach speaks sentence by sentence, and each sentence is a separate
   * API call. Without this, the provider has no idea the sentence is the
   * middle of a paragraph and re-invents the intonation every time — which
   * is audible as the voice randomly changing pitch and emphasis between
   * sentences, and occasionally landing on a shouted one. Providers call this
   * "request stitching"; it is what makes a chunked response sound like one
   * person talking instead of several takes spliced together.
   */
  previousText?: string;
}

/**
 * How much prior context to send. Enough for the model to hear the run-up to
 * this sentence, short enough not to bloat every request.
 */
export const MAX_PREVIOUS_TEXT_CHARS = 400;

export function trimPreviousText(text: string | undefined): string {
  if (!text) return "";
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_PREVIOUS_TEXT_CHARS) return t;
  // Keep the END of the prior text — that's what this sentence follows on from.
  const tail = t.slice(-MAX_PREVIOUS_TEXT_CHARS);
  const firstSpace = tail.indexOf(" ");
  return firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
}

/**
 * Stable cache key for a synthesis request. Any field that changes the audio
 * must be part of the key, or the cache would serve the wrong voice after a
 * settings change.
 */
/**
 * Bumped whenever the voice_settings sent to a provider change.
 *
 * Cached audio was produced under the settings in force at the time, so
 * without this a prosody fix is inaudible for every already-cached phrase —
 * the coach would keep replaying the old delivery for its most common lines.
 * Bumping this invalidates them; the old files age out of the cache normally.
 *
 * v2: stability 0.45 -> 0.72, style 0.35 -> 0, speaker boost off, and
 *     request stitching added, to stop intonation wandering between sentences.
 */
export const VOICE_SETTINGS_VERSION = "v2";

export function cacheKeyFor(req: SynthRequest): string {
  // JSON encoding gives an unambiguous joining of the fields for free: no
  // separator character can be confused with field content, so ("ab","c") and
  // ("a","bc") can never produce the same key.
  const canonical = JSON.stringify([
    req.provider,
    req.voice,
    req.model,
    VOICE_SETTINGS_VERSION,
    req.speed.toFixed(2),
    normalizeForKey(req.text),
    // Prior context changes the delivery, so it changes the audio and must be
    // part of the key. The fixed phrase set is unaffected: fillers are always
    // the first thing said in a stream, so their previousText is empty and
    // their warmed cache entries still hit.
    normalizeForKey(trimPreviousText(req.previousText)),
  ]);
  return fnv1a64(canonical);
}

// Text that differs only in surrounding or repeated whitespace produces
// identical audio, so folding it multiplies cache hits on the fixed phrase
// set (fillers, acknowledgements, completions).
function normalizeForKey(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// 64-bit FNV-1a-style hash as two 32-bit halves — no crypto import,
// deterministic, and far more than enough collision resistance for a local
// audio cache.
function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c << 3) | (c >>> 5);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Light rewrites that make synthesized speech land better. Applied in exactly
 * one place — every path into the TTS pipeline runs text through this — so the
 * startup cache warmer and the live session produce byte-identical strings and
 * therefore identical cache keys. Idempotent: running it twice is a no-op.
 */
export function preprocessForTts(text: string): string {
  return text
    .replace(/^(Okay|Alright|Cool|Nice|Right|Great|Got it|Perfect)(\s+)/i, "$1,$2")
    .replace(/ — /g, ", ")
    .replace(/\.{3}$/, ".")
    .trim();
}

// ── The coach's fixed phrase set ──
// These are spoken verbatim, over and over. Defined here rather than in the
// renderer so the startup cache warmer can reach them without IPC; the
// renderer re-exports them from src/hooks/useTts.ts.

/** Spoken on goal completion. */
export const COMPLETION_PHRASES: readonly string[] = [
  "And that's a wrap. Nice work.",
  "Done. Not bad at all.",
  "Nailed it — you're all set.",
  "That's the whole thing. Well played.",
  "Goal achieved. See? Wasn't so bad.",
];

/**
 * Spoken the instant the user asks a question, while the vision call runs.
 * Conversational fillers measurably improve perceived responsiveness for waits
 * over ~3 s — exactly the length of a vision call. These are the highest-value
 * entries in the cache: they play at 0 ms on the turn the user is waiting.
 */
export const THINKING_PHRASES: readonly string[] = [
  "Let me take a look.",
  "Hmm, let me see.",
  "Good question — one sec.",
  "Let me check that.",
  "Okay, looking now.",
];

/**
 * Spoken when the agent starts a web search mid-turn. Without it the user
 * sits through the whole lookup on a silent spinner, which reads as a freeze.
 */
export const LOOKUP_PHRASES: readonly string[] = [
  "Let me look that up.",
  "One sec, checking on that.",
  "Let me search that real quick.",
];

/**
 * Last resort when the user asked a direct question and the model still chose
 * to say nothing. The thinking filler has already played by then, so silence
 * reads as the coach ignoring them — these keep the exchange closed. Kept
 * deliberately vague: we're recovering precisely because we have no answer.
 */
export const NO_ANSWER_PHRASES: readonly string[] = [
  "Nothing new from me — you're good to keep going.",
  "You're on track — carry on with that last step.",
  "Still looks right to me — keep going.",
];

/**
 * Everything worth pre-synthesizing at startup, so the first filler of a
 * session plays instantly instead of paying full synthesis cost at the worst
 * possible moment.
 */
export const WARMABLE_PHRASES: readonly string[] = [
  ...THINKING_PHRASES,
  ...LOOKUP_PHRASES,
  ...COMPLETION_PHRASES,
  ...NO_ANSWER_PHRASES,
];

/**
 * ElevenLabs premade voices that suit a calm, competent coach. The Settings
 * picker lists whatever the account actually has (fetched live); this is the
 * offline default set and the source of the shipped default.
 */
export interface VoicePreset {
  id: string;
  name: string;
  blurb: string;
}

// IMPORTANT: these must all be **premade** voices, which every account can use.
// Voices from the shared Voice Library return HTTP 402 on free plans ("Free
// users cannot use library voices via the API"), and instantly-cloned voices
// return 401 — so a library voice as the shipped default means a new user's
// first experience is silence falling back to the robotic system voice.
// Verified against a live free-tier account: every id below synthesizes.
export const ELEVEN_VOICE_PRESETS: readonly VoicePreset[] = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", blurb: "Mature, reassuring, confident" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", blurb: "Clear, engaging educator" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", blurb: "Knowledgeable, professional" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", blurb: "Relaxed, neutral, informative" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", blurb: "Smooth, trustworthy" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", blurb: "Warm, captivating storyteller" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", blurb: "Deep, resonant, comforting" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", blurb: "Steady broadcaster" },
];

// Sarah: reassuring and even-paced, which is what someone being walked through
// a problem needs. Premade, so it works on every plan including free.
export const DEFAULT_ELEVEN_VOICE_ID = ELEVEN_VOICE_PRESETS[0].id;

// Flash v2.5 is the low-latency model (~75 ms model time-to-first-byte). The
// coach speaks in short sentences, which is exactly its sweet spot.
export const ELEVEN_MODEL = "eleven_flash_v2_5";

/**
 * 64 kbps 44.1 kHz MP3: audibly clean for speech and roughly half the bytes
 * of the 128 kbps default, so it finishes generating and transferring sooner.
 */
export const ELEVEN_OUTPUT_FORMAT = "mp3_44100_64";

/**
 * Long text defeats the point of sentence-level streaming and risks the
 * provider's per-request character limit. The chunker keeps us far below
 * this; the clamp is a guard against a pathological response.
 */
export const MAX_TTS_CHARS = 900;

export function clampTtsText(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_TTS_CHARS) return t;
  // Cut at the last sentence end that fits, else hard-cut on a word boundary.
  const head = t.slice(0, MAX_TTS_CHARS);
  const lastStop = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
  );
  if (lastStop > MAX_TTS_CHARS * 0.5) return head.slice(0, lastStop + 1);
  const lastSpace = head.lastIndexOf(" ");
  return lastSpace > 0 ? head.slice(0, lastSpace) : head;
}
