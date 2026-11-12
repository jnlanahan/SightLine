import { api } from "../lib/api";
import { takeAudioStart } from "../lib/askClock";
import { useSettings } from "../store/settings";
import {
  preprocessForTts,
  ACK_PHRASES,
  LOOKUP_PHRASES,
  NO_ANSWER_PHRASES,
  THINKING_PHRASES,
} from "../../electron/tts/shared";

// The fixed phrase set lives in electron/tts/shared.ts so the main process can
// pre-synthesize it at startup without an IPC round-trip. Re-exported here
// because this is where the rest of the renderer expects to find it — one
// definition, so a phrase can never drift out of the warm cache.
export { LOOKUP_PHRASES, NO_ANSWER_PHRASES, THINKING_PHRASES };

function pickRandom<T>(arr: readonly T[], avoid?: T): T {
  if (arr.length === 1) return arr[0];
  let next = arr[Math.floor(Math.random() * arr.length)];
  if (avoid !== undefined && next === avoid) {
    next = arr[(arr.indexOf(next) + 1) % arr.length];
  }
  return next;
}

let lastThinkingPhrase: string | undefined;
let lastAckPhrase: string | undefined;
let lastLookupPhrase: string | undefined;
let lastNoAnswerPhrase: string | undefined;

export function randomThinkingPhrase(): string {
  lastThinkingPhrase = pickRandom(THINKING_PHRASES, lastThinkingPhrase);
  return lastThinkingPhrase;
}

export function randomAckPhrase(): string {
  lastAckPhrase = pickRandom(ACK_PHRASES, lastAckPhrase);
  return lastAckPhrase;
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
  // `streamed`: the audio came piece by piece instead (audioBase64 is empty).
  | { ok: true; audioBase64: string; engine: CloudEngine; streamed: boolean }
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
  // Given this, the main process also sends the audio piece by piece under
  // this id while it is being made (see "Playing audio as it arrives").
  streamId?: string,
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
      streamId ? api().tts.speak(text, previousText, streamId) : api().tts.speak(text, previousText),
      IPC_TIMEOUT_MS,
      "tts_ipc_timeout",
    );
    if ("__error" in result) {
      const msg = (result as { message?: string }).message ?? "";
      console.warn("[SightLine TTS] cloud TTS error:", result.__error, msg);
      api().log(`[tts] cloud error: ${result.__error} ${msg}`.trim());
      return { ok: false, message: msg || result.__error };
    }
    return {
      ok: true,
      audioBase64: result.audioBase64,
      engine: result.engine,
      streamed: result.streamed === true,
    };
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

/** The Pace setting as a playback rate. A broken value means normal speed. */
export function playbackPace(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.max(0.7, Math.min(1.2, raw));
}

// ── Playing audio as it arrives ──
//
// A sentence used to be played only once ALL of its audio had arrived. With
// the current voice model that is 0.6 to 0.85 s, though the first audio is
// there after about a quarter of a second; the owner noticed the delay
// (second live run, 11 November 2026). So the main process now passes the
// audio on piece by piece, and a sentence starts on its first piece.
//
// Only the sentence the listener is waiting on gains from this. Later
// sentences are made while the one before them plays, and are usually whole
// by their turn — those still play the simple way, from one block.

/** One sentence's audio, arriving. */
interface Clip {
  id: string;
  chunks: Uint8Array<ArrayBuffer>[];
  /** No more pieces are coming. */
  finished: boolean;
  settled: boolean;
  /** The player, while one is attached: called for every piece and at the end. */
  onData: (() => void) | null;
  /** The request's own answer (whole audio when it was not streamed). */
  result: Promise<CloudAudio>;
  /** Resolves on the first piece, or when the request settles. */
  ready: Promise<void>;
  wake(): void;
}

const clips = new Map<string, Clip>();
let chunkListenerOn = false;
let clipSeq = 0;

/** Whether this browser can play MP3 that is still arriving. */
function canStreamAudio(): boolean {
  try {
    return (
      typeof MediaSource !== "undefined" &&
      MediaSource.isTypeSupported("audio/mpeg") &&
      typeof api().tts.onAudioChunk === "function"
    );
  } catch {
    return false;
  }
}

function releaseClip(clip: Clip) {
  if (clip.finished && clip.settled) clips.delete(clip.id);
}

function ensureChunkListener() {
  if (chunkListenerOn) return;
  chunkListenerOn = true;
  api().tts.onAudioChunk((ev) => {
    const clip = clips.get(ev.id);
    if (!clip) return;
    if (ev.chunk) clip.chunks.push(new Uint8Array(ev.chunk));
    if (ev.done) clip.finished = true;
    clip.wake();
    releaseClip(clip);
  });
}

/** Start making one sentence's audio, streamed when the browser can play it so. */
function startClip(text: string, previousText: string, gen: number): Clip {
  const streaming = canStreamAudio();
  let markReady: () => void = () => {};
  const clip: Clip = {
    id: `clip_${Date.now().toString(36)}_${++clipSeq}`,
    chunks: [],
    finished: false,
    settled: false,
    onData: null,
    result: Promise.resolve(CANCELLED),
    ready: new Promise<void>((resolve) => {
      markReady = resolve;
    }),
    wake() {
      markReady();
      clip.onData?.();
    },
  };
  if (streaming) {
    ensureChunkListener();
    clips.set(clip.id, clip);
  }
  clip.result = fetchCloudAudio(text, previousText, gen, streaming ? clip.id : undefined).then((r) => {
    clip.settled = true;
    // A streamed sentence ends with its own "done" piece, which normally
    // arrives before this answer. If it has not, give it a moment rather
    // than cutting the last pieces off; anything else is complete already.
    if (r.ok && r.streamed && !clip.finished) {
      setTimeout(() => {
        if (clip.finished) return;
        clip.finished = true;
        clip.wake();
        releaseClip(clip);
      }, 1500);
    } else {
      clip.finished = true;
    }
    clip.wake();
    releaseClip(clip);
    return r;
  });
  return clip;
}

function joinChunks(chunks: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function noteAudioStarted(engine: CloudEngine) {
  recordTtsMode(engine);
  const heard = takeAudioStart(Date.now());
  if (heard) {
    api().log(`[timing] audio started ${heard.ms}ms after ${heard.kind}`);
  }
}

/**
 * Play a sentence whose audio is still arriving. Resolves "played" once it
 * has been heard to the end (or was cancelled), or "unavailable" if playing
 * this way could not start at all — the caller then plays it the simple way.
 */
function playArriving(clip: Clip, gen: number): Promise<"played" | "unavailable"> {
  return new Promise((resolve) => {
    if (gen !== speakGeneration) {
      resolve("played");
      return;
    }
    let source: MediaSource;
    try {
      source = new MediaSource();
    } catch {
      resolve("unavailable");
      return;
    }
    const url = URL.createObjectURL(source);
    const audio = new Audio(url);
    audio.playbackRate = playbackPace(useSettings.getState().settings?.ttsSpeed);
    currentAudio = audio;

    let buffer: SourceBuffer | null = null;
    let fed = 0;
    let started = false;
    let settled = false;
    const release = () => {
      clip.onData = null;
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
    };
    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      release();
      if (reason !== "ended" && gen === speakGeneration) {
        console.warn(`[SightLine TTS] audio ${reason} (gen ${gen})`);
        api().log(`[tts] audio ${reason} (gen ${gen})`);
      }
      resolve("played");
    };
    // Something went wrong in the plumbing. If the listener has heard any of
    // it, the sentence is spent; if not, the caller can still play it whole.
    const giveUp = () => {
      if (settled) return;
      settled = true;
      release();
      try {
        audio.pause();
      } catch {
        // already gone
      }
      resolve(started || gen !== speakGeneration ? "played" : "unavailable");
    };
    const feed = () => {
      if (settled || !buffer || buffer.updating) return;
      if (fed < clip.chunks.length) {
        try {
          buffer.appendBuffer(clip.chunks[fed++]);
        } catch {
          giveUp();
        }
        return;
      }
      if (clip.finished && source.readyState === "open") {
        try {
          source.endOfStream();
        } catch {
          // already ended
        }
      }
    };
    source.addEventListener(
      "sourceopen",
      () => {
        try {
          buffer = source.addSourceBuffer("audio/mpeg");
        } catch {
          giveUp();
          return;
        }
        buffer.addEventListener("updateend", () => {
          if (!started && !settled) {
            audio.play().then(
              () => {
                started = true;
                noteAudioStarted("elevenlabs");
              },
              () => giveUp(),
            );
          }
          feed();
        });
        buffer.addEventListener("error", giveUp);
        feed();
      },
      { once: true },
    );
    clip.onData = feed;
    audio.onended = () => finish("ended");
    audio.onerror = () => (started ? finish("error") : giveUp());
    audio.onabort = () => finish("abort");
  });
}

/**
 * Play one sentence's audio: as it arrives when it is still arriving, from
 * one block when it is already whole. Resolves true if it played (or was
 * cancelled), false if nothing could be played — the caller falls back to
 * the system voice.
 */
async function playClip(clip: Clip, gen: number): Promise<boolean> {
  await clip.ready;
  if (gen !== speakGeneration) return true;
  if (clip.chunks.length > 0 && !clip.finished) {
    const outcome = await playArriving(clip, gen);
    if (outcome === "played") return true;
  }
  const result = await clip.result;
  if (gen !== speakGeneration) return true;
  if (!result.ok) return false;
  if (result.streamed) {
    // Every piece came by the side channel; wait for the last of them.
    while (!clip.finished) {
      await new Promise<void>((resolve) => {
        clip.onData = resolve;
      });
    }
    clip.onData = null;
    if (gen !== speakGeneration) return true;
    if (clip.chunks.length === 0) return false;
    return playAudioBytes(joinChunks(clip.chunks), result.engine, gen);
  }
  if (!result.audioBase64) return false;
  const bytes = Uint8Array.from(atob(result.audioBase64), (c) => c.charCodeAt(0));
  return playAudioBytes(bytes, result.engine, gen);
}

// Play one synthesized chunk to completion. Resolves true if the audio
// played (or was cancelled), false if playback couldn't start — the caller
// then falls back to web speech.
function playAudioBytes(
  bytes: Uint8Array<ArrayBuffer>,
  engine: CloudEngine,
  gen: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (gen !== speakGeneration) {
      resolve(true); // cancelled while synthesizing
      return;
    }
    const blob = new Blob([bytes], { type: "audio/mp3" });
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    // The Pace setting. Applied here rather than asked of the provider: the
    // voice model ignores a requested speed, and this way the slider means
    // the same thing whichever provider spoke. Pitch is preserved.
    audio.playbackRate = playbackPace(useSettings.getState().settings?.ttsSpeed);
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
      () => noteAudioStarted(engine),
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
    /** The sentence's audio, being made. Null once the stream has fallen back
     *  to the system voice. */
    clip: Clip | null;
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
        if (!degraded && item.clip) {
          // Starts on the first piece of audio when it is still arriving.
          const played = await playClip(item.clip, gen);
          if (gen !== speakGeneration) return;
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
        clip: degraded ? null : startClip(trimmed, previousText, gen),
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
