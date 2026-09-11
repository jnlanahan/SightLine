import OpenAI from "openai";
import { getKey } from "./credentials";

export type TtsVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "shimmer"
  | "coral"
  | "sage";

type SupportedVoice = "alloy" | "echo" | "fable" | "nova" | "onyx" | "shimmer";

export interface SpeakOptions {
  voice?: TtsVoice;
  /** Aborts the HTTP request itself, so a timed-out call doesn't keep running. */
  signal?: AbortSignal;
}

const TONE_INSTRUCTIONS =
  "Speak in a warm, conversational tone — like a patient, knowledgeable friend sitting next to you. " +
  "Take your time between sentences. Natural pauses, unhurried pacing. " +
  "Friendly but calm — not peppy, not flat. Real, relaxed, and easy to follow.";

// Remap extended voices to the subset supported by tts-1-hd fallback only.
function toFallbackVoice(voice: TtsVoice): SupportedVoice {
  switch (voice) {
    case "coral":
      return "shimmer";
    case "sage":
      return "nova";
    default:
      return voice;
  }
}

export async function speakText(
  text: string,
  opts: SpeakOptions = {},
): Promise<Buffer> {
  const apiKey = await getKey("openai");
  if (!apiKey) throw new Error("missing_openai_key");

  const client = new OpenAI({ apiKey });
  const voice = opts.voice ?? "nova";
  const fallbackVoice = toFallbackVoice(voice);

  // Try the expressive model first — it accepts tone instructions, supports all
  // voices including coral/sage, and sounds noticeably more human.
  // Falls back to tts-1-hd on 403/404/400/422 (account lacks access).
  const requestOptions = opts.signal ? { signal: opts.signal } : undefined;
  try {
    const response = await client.audio.speech.create(
      {
        model: "gpt-4o-mini-tts" as "tts-1-hd",
        voice: voice as SupportedVoice,
        input: text,
        response_format: "mp3",
        instructions: TONE_INSTRUCTIONS,
      },
      requestOptions,
    );
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    const status = (err as { status?: number })?.status;
    if (status === 403 || status === 404 || status === 400 || status === 422) {
      const response = await client.audio.speech.create(
        {
          model: "tts-1-hd",
          voice: fallbackVoice,
          input: text,
          response_format: "mp3",
        },
        requestOptions,
      );
      return Buffer.from(await response.arrayBuffer());
    }
    throw err;
  }
}
