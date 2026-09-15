import { api } from "../lib/api";
import { useSession } from "../store/session";
import {
  preprocessForTts,
  COMPLETION_PHRASES,
  LOOKUP_PHRASES,
  NO_ANSWER_PHRASES,
  THINKING_PHRASES,
} from "../../electron/tts/shared";

// The fixed phrase set lives in electron/tts/shared.ts so the main process can
// pre-synthesize it at startup without an IPC round-trip. Re-exported here
// because this is where the rest of the renderer expects to find it — one
// definition, so a phrase can never drift out of the warm cache.
export { COMPLETION_PHRASES, LOOKUP_PHRASES, NO_ANSWER_PHRASES, THINKING_PHRASES };

function pickRandom<T>(arr: readonly T[], avoid?: T): T {
  if (arr.length === 1) return arr[0];
  let next = arr[Math.floor(Math.random() * arr.length)];
  if (avoid !== undefined && next === avoid) {
    next = arr[(arr.indexOf(next) + 1) % arr.length];
  }
  return next;
}

let lastCompletionPhrase: string | undefined;
let lastThinkingPhrase: string | undefined;
let lastLookupPhrase: string | undefined;
let lastNoAnswerPhrase: string | undefined;

export function randomCompletionPhrase(): string {
  lastCompletionPhrase = pickRandom(COMPLETION_PHRASES, lastCompletionPhrase);
  return lastCompletionPhrase;
}

export function randomThinkingPhrase(): string {
  lastThinkingPhrase = pickRandom(THINKING_PHRASES, lastThinkingPhrase);
  return lastThinkingPhrase;
}

export function randomLookupPhrase(): string {
  lastLookupPhrase = pickRandom(LOOKUP_PHRASES, lastLookupPhrase);
  return lastLookupPhrase;
}

export function randomNoAnswerPhrase(): string {
  lastNoAnswerPhrase = pickRandom(NO_ANSWER_PHRASES, lastNoAnswerPhrase);
  return lastNoAnswerPhrase;
}

// Module-level audio state so cancel() works across renders.
let currentAudio: HTMLAudioElement | null = null;
let speakGeneration = 0;
// True from stream open until every queued chunk has finished playing
// (including the cloud-synthesis fetch window, when no audio element exists
// yet) — so callers checking isSpeaking() can't fire a tick that cancels
// still-loading audio.
let pendingSpeech = false;
// Providers that return real synthesized audio, vs. the browser's own voice.
type CloudEngine = "elevenlabs" | "google" | "openai";
type TtsMode = CloudEngine | "system" | "none" | null;
let lastTtsMode: TtsMode = null;

function recordTtsMode(mode: TtsMode) {
  lastTtsMode = mode;
  useSession.getState().setLastTtsEngine(mode);
}

// Speech completion tracking — lets the session loop wait for audio to finish
// before scheduling the next tick, preventing mid-sentence cutoffs.
let speakDoneResolve: (() => void) | null = null;
let speakDonePromise: Promise<void> = Promise.resolve();

export function waitForSpeechEnd(maxWaitMs = 45_000): Promise<void> {
  // Safety net: never let a caller hang forever on a speech promise that a
  // future bug fails to resolve.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxWaitMs);
  });
  return Promise.race([speakDonePromise, cap]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

export function getTtsMode(): TtsMode {
  return lastTtsMode;
}

export function isSpeaking(): boolean {
  return pendingSpeech;
}

/**
 * Stop speaking immediately, mid-word. This is barge-in: when the user starts
 * talking, the coach shuts up the same instant a person would. Also used when
 * a session is paused or stopped.
 */
export function cancelSpeech(): void {
  cancelCurrent();
}

function cancelCurrent() {
  speakGeneration++;
  pendingSpeech = false;
  speakDoneResolve?.(); // speech is done (cancelled) — unblock any waiters
  speakDoneResolve = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([p, deadline]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

type CloudAudio =
  | { ok: true; audioBase64: string; engine: CloudEngine }
  | { ok: false; message: string };

// Cap on synthesis requests in flight at once.
//
// Speech is pipelined — chunk N+1 is synthesized while chunk N plays — which
// is what makes the coach feel responsive. But a fast multi-sentence response
// can put four requests in the air simultaneously, and ElevenLabs' free tier
// allows two. The rejected chunk downgrades the REST of that response to the
// system voice, so the coach starts well and then turns robotic mid-answer.
// Queuing instead costs nothing on paid plans (the pipeline is still a chunk
// ahead of playback) and prevents that entirely.
const MAX_CONCURRENT_SYNTHESIS = 2;

// The main process runs its own per-provider timeouts and falls through the
// provider chain; this only has to outlast that whole chain. It exists so a
// stuck IPC channel can never leave playback hung — on timeout the chunk falls
// through to the system voice.
const IPC_TIMEOUT_MS = 25_000;

let inFlightSynthesis = 0;
const synthesisWaiters: Array<() => void> = [];

async function acquireSynthesisSlot(): Promise<void> {
  if (inFlightSynthesis < MAX_CONCURRENT_SYNTHESIS) {
    inFlightSynthesis++;
    return;
  }
  await new Promise<void>((resolve) => synthesisWaiters.push(resolve));
  inFlightSynthesis++;
}

function releaseSynthesisSlot(): void {
  inFlightSynthesis--;
  const next = synthesisWaiters.shift();
  if (next) next();
}

const CANCELLED: CloudAudio = { ok: false, message: "cancelled" };

// Kick off cloud synthesis for one chunk. Called the moment a chunk is
// enqueued, so chunk N+1 synthesizes while chunk N is still playing.
async function fetchCloudAudio(
  text: string,
  previousText: string,
  gen: number,
): Promise<CloudAudio> {
  // A cancelled stream's chunks must not occupy synthesis slots. Without this
  // check, a barge-in mid-answer left up to five stale requests queued ahead
  // of the next stream's thinking filler — the "instant" filler arrived
  // seconds late, and every stale sentence was synthesized and billed for
  // audio nobody would hear.
  if (gen !== speakGeneration) return CANCELLED;
  await acquireSynthesisSlot();
  try {
    if (gen !== speakGeneration) return CANCELLED;
    const result = await withTimeout(
      api().tts.speak(text, previousText),
      IPC_TIMEOUT_MS,
      "tts_ipc_timeout",
    );
    if ("__error" in result) {
      const msg = (result as { message?: string }).message ?? "";
      console.warn("[SightLine TTS] cloud TTS error:", result.__error, msg);
      api().log(`[tts] cloud error: ${result.__error} ${msg}`.trim());
      return { ok: false, message: msg || result.__error };
    }
    return { ok: true, audioBase64: result.audioBase64, engine: result.engine };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[SightLine TTS] cloud TTS failed:", err);
    api().log(`[tts] cloud failed: ${msg}`);
    return { ok: false, message: msg };
  } finally {
    // Must release on every path — a leaked slot would permanently shrink the
    // pipeline and eventually deadlock all speech.
    releaseSynthesisSlot();
  }
}

// Play one synthesized chunk to completion. Resolves true if the audio
// played (or was cancelled), false if playback couldn't start — the caller
// then falls back to web speech.
function playAudioBuffer(
  audioBase64: string,
  engine: CloudEngine,
  gen: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (gen !== speakGeneration) {
      resolve(true); // cancelled while synthesizing
      return;
    }
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/mp3" });
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    currentAudio = audio;

    // Shared end-of-life cleanup for ended/error/abort so a failed audio
    // element can never leave the queue pump hanging.
    let settled = false;
    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(blobUrl);
      if (currentAudio === audio) currentAudio = null;
      if (reason !== "ended" && gen === speakGeneration) {
        console.warn(`[SightLine TTS] audio ${reason} (gen ${gen})`);
        api().log(`[tts] audio ${reason} (gen ${gen})`);
      }
      resolve(true);
    };
    audio.onended = () => finish("ended");
    audio.onerror = () => finish("error");
    audio.onabort = () => finish("abort");

    audio.play().then(
      () => recordTtsMode(engine),
      (playErr) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(blobUrl);
        if (currentAudio === audio) currentAudio = null;
        // A cancel that lands during the decode gap rejects play() BEFORE the
        // abort event fires. That is not a playback failure, and treating it
        // as one made the system voice read out a sentence the user had just
        // interrupted. Only a rejection on a live stream means "fall back".
        if (gen !== speakGeneration) {
          resolve(true);
          return;
        }
        console.warn("[SightLine TTS] audio.play() failed:", playErr);
        resolve(false);
      },
    );
  });
}

// Web Speech gives no reliable end event in every Chromium build, so the
// wait is capped by a generous reading-time estimate of the text.
const WEB_SPEECH_MS_PER_CHAR = 70;
const WEB_SPEECH_MIN_MS = 1_500;
const WEB_SPEECH_MAX_MS = 30_000;

// Speak with the browser's own voice. Resolves when the utterance ends (or
// errors, or the time cap passes) so the queue pump — and therefore
// isSpeaking() — stays truthful while the system voice is talking. The old
// fire-and-forget version reported "done" on hand-off, which let the next
// tick's stream cancel the sentence mid-word.
function playWebSpeech(text: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    console.warn("[SightLine TTS] speechSynthesis not available.");
    return Promise.resolve();
  }
  console.warn(
    "[SightLine TTS] Using system speech synthesis. Check your ElevenLabs/Google/OpenAI keys and network for the natural voice.",
  );

  return new Promise<void>((resolve) => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.0;
    utt.pitch = 1.0;

    let settled = false;
    let cap: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (settled) return;
      settled = true;
      if (cap !== null) clearTimeout(cap);
      resolve();
    };
    utt.onend = done;
    utt.onerror = done;
    const capMs = Math.min(
      WEB_SPEECH_MAX_MS,
      Math.max(WEB_SPEECH_MIN_MS, text.length * WEB_SPEECH_MS_PER_CHAR),
    );
    cap = setTimeout(done, capMs);

    function pickVoice(voices: SpeechSynthesisVoice[]) {
      const en = (v: SpeechSynthesisVoice) => v.lang.startsWith("en");
      return (
        voices.find((v) => v.name.includes("Natural") && en(v)) ??
        voices.find((v) => v.lang === "en-US") ??
        voices.find(en) ??
        null
      );
    }

    recordTtsMode("system");
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const v = pickVoice(voices);
      if (v) utt.voice = v;
      window.speechSynthesis.speak(utt);
    } else {
      // Voices haven't loaded yet — attach listener then speak.
      const handler = () => {
        window.speechSynthesis.onvoiceschanged = null;
        const v = pickVoice(window.speechSynthesis.getVoices());
        if (v) utt.voice = v;
        window.speechSynthesis.speak(utt);
      };
      window.speechSynthesis.onvoiceschanged = handler;
      // Safety net: if the event never fires, speak with default voice.
      window.setTimeout(() => {
        if (window.speechSynthesis.onvoiceschanged === handler) {
          window.speechSynthesis.onvoiceschanged = null;
          window.speechSynthesis.speak(utt);
        }
      }, 500);
    }
  });
}

// A speech stream: sentences are enqueued as they arrive (from the streaming
// Claude response) and played strictly in order. Synthesis of chunk N+1
// starts the moment it's enqueued — while chunk N is still playing — so the
// gap between sentences is just the natural sentence pause.
export interface SpeechStream {
  enqueue(text: string): void;
  // No more chunks coming. waitForSpeechEnd() resolves once the queue drains.
  end(): void;
}

export function openSpeechStream(): SpeechStream {
  cancelCurrent(); // resolves previous promise, increments generation
  const gen = speakGeneration;
  pendingSpeech = true;
  speakDonePromise = new Promise<void>((resolve) => {
    speakDoneResolve = resolve;
  });
  lastTtsMode = null;

  interface QueueItem {
    text: string;
    audioPromise: Promise<CloudAudio>;
  }
  const queue: QueueItem[] = [];
  let ended = false;
  let pumping = false;
  // Everything enqueued so far in THIS response. Sent with each subsequent
  // chunk so the provider continues the same delivery rather than starting a
  // fresh performance every sentence — without it, intonation wanders and the
  // occasional sentence comes out shouted.
  let spokenSoFar = "";
  // Once one chunk falls back to the system voice, all later chunks in this
  // stream do too — speechSynthesis queues utterances natively, and mixing
  // voices mid-stream sounds broken.
  let degraded = false;

  const finishAll = () => {
    if (gen !== speakGeneration) return;
    pendingSpeech = false;
    speakDoneResolve?.();
    speakDoneResolve = null;
    api().log(`[tts] stream drained (gen ${gen})`);
  };

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        if (gen !== speakGeneration) return; // cancelled
        const item = queue.shift()!;
        const result = degraded
          ? ({ ok: false, message: "degraded" } as const)
          : await item.audioPromise;
        if (gen !== speakGeneration) return;
        if (result.ok) {
          const played = await playAudioBuffer(
            result.audioBase64,
            result.engine,
            gen,
          );
          if (played) continue;
        }
        // Cancelled while the cloud chunk was failing to start — nothing to
        // fall back to, the user moved on.
        if (gen !== speakGeneration) return;
        if (!degraded) {
          degraded = true;
          api().log(`[tts] falling back to web speech (gen ${gen})`);
        }
        if (typeof window !== "undefined" && window.speechSynthesis) {
          await playWebSpeech(item.text);
        } else {
          recordTtsMode("none");
        }
      }
      if (ended && gen === speakGeneration) finishAll();
    } finally {
      pumping = false;
      if (gen === speakGeneration && queue.length > 0) void pump();
    }
  }

  return {
    enqueue(text: string) {
      if (gen !== speakGeneration || ended) return;
      const trimmed = preprocessForTts(text.trim());
      if (!trimmed) return;
      api().log(`[tts] enqueue (gen ${gen}): "${trimmed.slice(0, 40)}"`);
      // Capture the context BEFORE appending this chunk — the first chunk of a
      // response has no predecessor, which is also what keeps the warmed
      // phrase cache hitting for fillers.
      const previousText = spokenSoFar;
      spokenSoFar = spokenSoFar ? `${spokenSoFar} ${trimmed}` : trimmed;
      queue.push({
        text: trimmed,
        audioPromise: degraded
          ? Promise.resolve({ ok: false, message: "degraded" })
          : fetchCloudAudio(trimmed, previousText, gen),
      });
      void pump();
    },
    end() {
      if (gen !== speakGeneration || ended) return;
      ended = true;
      if (!pumping && queue.length === 0) finishAll();
    },
  };
}

export function useTts() {
  function speak(text: string) {
    if (!text.trim()) return;
    const stream = openSpeechStream();
    stream.enqueue(text);
    stream.end();
  }

  function cancel() {
    cancelCurrent();
  }

  return { speak, cancel };
}
