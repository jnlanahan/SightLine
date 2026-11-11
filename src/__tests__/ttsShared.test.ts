import { describe, expect, it } from "vitest";
import {
  ACK_PHRASES,
  DEFAULT_ELEVEN_VOICE_ID,
  ELEVEN_MODEL,
  ELEVEN_VOICE_PRESETS,
  LOOKUP_PHRASES,
  MAX_TTS_CHARS,
  NO_ANSWER_PHRASES,
  THINKING_PHRASES,
  VOICE_SETTINGS_VERSION,
  WARMABLE_PHRASES,
  cacheKeyFor,
  clampTtsText,
  preprocessForTts,
  type SynthRequest,
} from "../../electron/tts/shared";

const base: SynthRequest = {
  text: "Go ahead and click Save.",
  provider: "elevenlabs",
  voice: "voice-a",
  model: "eleven_flash_v2_5",
  speed: 1,
};

describe("cacheKeyFor", () => {
  it("is stable for identical requests", () => {
    expect(cacheKeyFor(base)).toBe(cacheKeyFor({ ...base }));
  });

  it("changes when any audio-affecting field changes", () => {
    const key = cacheKeyFor(base);
    expect(cacheKeyFor({ ...base, voice: "voice-b" })).not.toBe(key);
    expect(cacheKeyFor({ ...base, provider: "google" })).not.toBe(key);
    expect(cacheKeyFor({ ...base, model: "other" })).not.toBe(key);
    expect(cacheKeyFor({ ...base, speed: 1.1 })).not.toBe(key);
    expect(cacheKeyFor({ ...base, text: "Something else." })).not.toBe(key);
  });

  it("ignores differences that do not change the audio", () => {
    const key = cacheKeyFor(base);
    expect(cacheKeyFor({ ...base, text: "  Go ahead and click Save.  " })).toBe(key);
    expect(cacheKeyFor({ ...base, text: "Go ahead and\n click   Save." })).toBe(key);
  });

  it("cannot be confused by field contents that look like separators", () => {
    // Field boundaries must be unambiguous: shifting a character from one
    // field to the next has to produce a different key.
    const a = cacheKeyFor({ ...base, voice: "ab", model: "c" });
    const b = cacheKeyFor({ ...base, voice: "a", model: "bc" });
    expect(a).not.toBe(b);
  });

  it("produces a filesystem-safe key", () => {
    expect(cacheKeyFor({ ...base, text: 'a/b\\c:"*?<>|' })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("preprocessForTts", () => {
  it("is idempotent — the warm cache and the live session must agree", () => {
    for (const phrase of WARMABLE_PHRASES) {
      const once = preprocessForTts(phrase);
      expect(preprocessForTts(once)).toBe(once);
    }
  });

  it("replaces spoken-hostile em dashes with a comma pause", () => {
    expect(preprocessForTts("No rush — take your time.")).toBe(
      "No rush, take your time.",
    );
  });

  it("never doubles the comma when an opener is followed by a dash", () => {
    // Heard live: "Great — System Information is open" reached the voice as
    // "Great,, System Information is open".
    expect(preprocessForTts("Great — System Information is open.")).toBe(
      "Great, System Information is open.",
    );
    expect(preprocessForTts("Got it — RTX 4070 confirmed.")).toBe(
      "Got it, RTX 4070 confirmed.",
    );
  });

  it("handles a dash with no spaces around it", () => {
    expect(preprocessForTts("Nailed it—you're all set.")).toBe(
      "Nailed it, you're all set.",
    );
  });

  it("adds a beat after a bare opener", () => {
    expect(preprocessForTts("Okay click the gear.")).toBe("Okay, click the gear.");
  });

  it("leaves an opener that already has its comma alone", () => {
    expect(preprocessForTts("Okay, looking now.")).toBe("Okay, looking now.");
  });

  it("collapses a trailing ellipsis to a full stop", () => {
    expect(preprocessForTts("Hang on...")).toBe("Hang on.");
  });
});

describe("WARMABLE_PHRASES", () => {
  it("covers every phrase the coach speaks verbatim", () => {
    for (const phrase of [
      ...THINKING_PHRASES,
      ...ACK_PHRASES,
      ...LOOKUP_PHRASES,
      ...NO_ANSWER_PHRASES,
    ]) {
      expect(WARMABLE_PHRASES).toContain(phrase);
    }
  });

  it("has no duplicates — a duplicate is a wasted synthesis at startup", () => {
    expect(new Set(WARMABLE_PHRASES).size).toBe(WARMABLE_PHRASES.length);
  });

  it("stays short enough to synthesize fast", () => {
    for (const phrase of WARMABLE_PHRASES) {
      expect(phrase.length).toBeLessThan(60);
    }
  });

  // The first live run: pressing "I did this" got "Good question, one sec."
  // A filler plays before the coach knows what was said, so it must not
  // presume the user asked anything.
  it("no filler presumes the user asked a question", () => {
    for (const phrase of [...THINKING_PHRASES, ...ACK_PHRASES]) {
      expect(phrase.toLowerCase()).not.toContain("question");
    }
  });

  it("acknowledgements come out of the speech preprocessor unchanged, so the warm cache hits", () => {
    for (const phrase of ACK_PHRASES) {
      expect(preprocessForTts(phrase)).toBe(phrase);
    }
  });
});

describe("the ElevenLabs voice model", () => {
  // Changed on purpose after the first live run ("the voice sounds so
  // unnatural"). The request below was checked against the live service; a
  // different model may not take the same one, so changing either is a
  // decision, not a tidy-up.
  it("is v4 Turbo, and cached audio from the old model is not reused", () => {
    expect(ELEVEN_MODEL).toBe("eleven_v4_turbo");
    expect(VOICE_SETTINGS_VERSION).toBe("v3");
  });

  it("is asked for stability and similarity only — it ignores a requested speed", async () => {
    const src = (await import("../../electron/tts/elevenlabs?raw")) as unknown as {
      default: string;
    };
    expect(src.default).toContain("stability: 0.5,");
    expect(src.default).toContain("similarity_boost: 0.75,");
    expect(src.default).not.toContain("speed:");
    expect(src.default).not.toContain("use_speaker_boost:");
    // Request stitching is what holds a sentence-by-sentence reply together.
    expect(src.default).toContain("body.previous_text = previous");
  });
});

describe("clampTtsText", () => {
  it("passes normal-length text through untouched", () => {
    expect(clampTtsText("Click the blue button.")).toBe("Click the blue button.");
  });

  it("cuts overlong text at a sentence boundary when there is one", () => {
    const sentence = "This is a sentence that runs on for a while. ";
    const long = sentence.repeat(40);
    const out = clampTtsText(long);
    expect(out.length).toBeLessThanOrEqual(MAX_TTS_CHARS);
    expect(out.endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary when there is no sentence break", () => {
    const long = "word ".repeat(400);
    const out = clampTtsText(long);
    expect(out.length).toBeLessThanOrEqual(MAX_TTS_CHARS);
    expect(out.endsWith(" ")).toBe(false);
  });

  it("never returns an empty string for non-empty input", () => {
    expect(clampTtsText("x".repeat(2000)).length).toBeGreaterThan(0);
  });
});

describe("ElevenLabs voice presets", () => {
  // Voices from the shared Voice Library return HTTP 402 on free plans and
  // instantly-cloned voices return 401. Shipping either as a preset — and
  // especially as the DEFAULT — means a new user's first experience is the
  // robotic system voice. Every id below was verified against a live free-tier
  // account; keep that true when editing this list.
  const LIBRARY_ONLY_IDS = new Set([
    "21m00Tcm4TlvDq8ikWAM", // Rachel
    "XB0fDUnXU5powFXDhCwa", // Charlotte
  ]);

  it("ships a default that works on every plan", () => {
    expect(LIBRARY_ONLY_IDS.has(DEFAULT_ELEVEN_VOICE_ID)).toBe(false);
  });

  it("has a default that is one of the presets", () => {
    expect(ELEVEN_VOICE_PRESETS.map((v) => v.id)).toContain(
      DEFAULT_ELEVEN_VOICE_ID,
    );
  });

  it("contains no plan-gated voices at all", () => {
    for (const preset of ELEVEN_VOICE_PRESETS) {
      expect(LIBRARY_ONLY_IDS.has(preset.id)).toBe(false);
    }
  });

  it("has unique ids and non-empty names", () => {
    const ids = ELEVEN_VOICE_PRESETS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ELEVEN_VOICE_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
    }
  });

  it("offers a range of voices to choose from", () => {
    expect(ELEVEN_VOICE_PRESETS.length).toBeGreaterThanOrEqual(6);
  });
});
