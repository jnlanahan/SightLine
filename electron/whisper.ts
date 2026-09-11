import OpenAI from "openai";
import { getKey } from "./credentials";

export class MissingOpenAIKeyError extends Error {
  constructor() {
    super("OpenAI API key is not configured");
    this.name = "MissingOpenAIKeyError";
  }
}

export interface TranscribeArgs {
  // base64-encoded webm/ogg/wav audio (without data URL prefix)
  audioBase64: string;
  mimeType: string;
}

export async function transcribe(args: TranscribeArgs): Promise<string> {
  const apiKey = await getKey("openai");
  if (!apiKey) throw new MissingOpenAIKeyError();

  const client = new OpenAI({ apiKey });
  const buffer = Buffer.from(args.audioBase64, "base64");
  const ext = pickExtension(args.mimeType);
  const file = await OpenAI.toFile(buffer, `audio.${ext}`, {
    type: args.mimeType,
  });
  // gpt-4o-mini-transcribe is faster and more accurate than whisper-1 for
  // short voice commands; fall back if the account lacks access. The
  // language hint stops the model guessing a language from a half-second of
  // breath noise, which is where most of the "Thank you." hallucinations on
  // short clips come from.
  try {
    const result = await client.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      language: "en",
    });
    return result.text.trim();
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // 403/404/422 mean "this account can't use that model". A 400 is a bad
    // request — typically a clip too short to decode — and re-uploading the
    // same clip to a second model just fails twice.
    if (status === 403 || status === 404 || status === 422) {
      const result = await client.audio.transcriptions.create({
        model: "whisper-1",
        file,
        language: "en",
      });
      return result.text.trim();
    }
    throw err;
  }
}

function pickExtension(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}
