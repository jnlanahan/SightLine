import { useCallback, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import { cancelSpeech } from "./useTts";

// A hold shorter than this is almost always a stray key tap, not speech.
// Transcribing it would submit garbage as a follow-up — speech models
// hallucinate "Thank you." or "you" on near-silent clips, and that text then
// triggers a real Claude call. Half a second is still well under the time it
// takes to say one word.
const MIN_HOLD_MS = 500;

// Hard ceiling on one utterance. Guards against a stuck key or a user who
// walks away mid-hold leaving the mic open indefinitely.
const MAX_HOLD_MS = 60_000;

type StopReason = "released" | "too-short" | "timeout" | "cancelled";

/**
 * Hold-to-talk with barge-in.
 *
 * Press (push-to-talk key, or the mic button): the coach stops speaking
 * mid-word, the loop is frozen, and the mic opens.
 * Release: audio goes to Whisper and the transcript is submitted as a
 * follow-up, which fires a tick immediately.
 *
 * The whole point is that interrupting is allowed to be rude — a real person
 * stops talking the instant you start.
 */
export function usePushToTalk(onTranscript: (text: string) => void) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const maxHoldTimerRef = useRef<number | null>(null);
  // Guards against overlapping start/stop when the key is hammered.
  const busyRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (maxHoldTimerRef.current !== null) {
      window.clearTimeout(maxHoldTimerRef.current);
      maxHoldTimerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    const s = useSession.getState();
    // Nothing to interrupt and nothing to answer before a session exists.
    if (!s.goal) return;
    if (s.listening) return;
    busyRef.current = true;

    try {
      // Barge-in first, before anything that can fail or take time: the user
      // pressed the key because they want the coach to stop NOW.
      if (useSettings.getState().settings?.bargeInEnabled !== false) {
        cancelSpeech();
      }
      useSession.getState().setListening(true);
      useSession.getState().setLastTranscript(null);
      api().log("[ptt] listening");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      // The key may have been released while permission was being granted.
      if (!useSession.getState().listening) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();

      maxHoldTimerRef.current = window.setTimeout(() => {
        api().log("[ptt] max hold reached — closing the mic");
        void stop("timeout");
      }, MAX_HOLD_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api().log(`[ptt] could not open the mic: ${msg}`);
      useSession.getState().setListening(false);
      useSession
        .getState()
        .setError(
          "Couldn't open the microphone. Check Windows mic permissions for SightLine.",
        );
      cleanupStream();
    } finally {
      busyRef.current = false;
    }
  }, [cleanupStream]);

  const stop = useCallback(
    async (reason: StopReason = "released") => {
      const s = useSession.getState();
      if (!s.listening) return;
      useSession.getState().setListening(false);

      const recorder = recorderRef.current;
      const heldMs = Date.now() - startedAtRef.current;

      if (!recorder || recorder.state === "inactive") {
        cleanupStream();
        return;
      }

      if (reason === "cancelled" || heldMs < MIN_HOLD_MS) {
        // Discard: too short to be speech, or explicitly abandoned.
        try {
          recorder.stop();
        } catch {
          // already stopped
        }
        cleanupStream();
        if (reason !== "cancelled") {
          api().log(`[ptt] ignored a ${heldMs}ms tap (too short to be speech)`);
        }
        return;
      }

      const mime = recorder.mimeType || "audio/webm";
      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      // Flag the hand-off BEFORE awaiting the recorder: `listening` just went
      // false, and until `transcribing` is true the loop's "user is speaking"
      // guard is off — a backstop tick could start a Claude call in that gap
      // and the transcript would then land mid-"thinking".
      useSession.getState().setTranscribing(true);
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
      await done;
      cleanupStream();

      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      if (blob.size === 0) {
        api().log("[ptt] no audio captured");
        useSession.getState().setTranscribing(false);
        return;
      }

      try {
        const base64 = await blobToBase64(blob);
        const result = await api().whisper.transcribe({
          audioBase64: base64,
          mimeType: mime,
        });
        if ("__error" in result) {
          const err = result as { __error: string; message?: string };
          api().log(`[ptt] transcription failed: ${err.__error} ${err.message ?? ""}`);
          useSession
            .getState()
            .setError(
              err.__error === "missing_openai_key"
                ? "Voice input needs an OpenAI key (Whisper). Add one in Settings."
                : "Couldn't transcribe that — try again or type it instead.",
            );
          return;
        }
        const text = (result as { text: string }).text.trim();
        if (!text) {
          api().log("[ptt] transcript was empty");
          return;
        }
        api().log(`[ptt] heard: "${text.slice(0, 60)}"`);
        useSession.getState().setLastTranscript(text);
        onTranscriptRef.current(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api().log(`[ptt] transcription threw: ${msg}`);
      } finally {
        useSession.getState().setTranscribing(false);
      }
    },
    [cleanupStream],
  );

  // Global push-to-talk key edges from the main process.
  useEffect(() => {
    return api().voice.onPushToTalk((down) => {
      if (down) void start();
      else void stop("released");
    });
  }, [start, stop]);

  // Never leave the mic open if the component unmounts mid-hold.
  useEffect(() => {
    return () => {
      if (useSession.getState().listening) {
        useSession.getState().setListening(false);
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
    /** For the on-screen mic button — same path as the hotkey. */
    startTalking: start,
    stopTalking: () => void stop("released"),
    cancelTalking: () => void stop("cancelled"),
  };
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    )
      return c;
  }
  return "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(binary);
}
