import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type VoiceState = "idle" | "recording" | "transcribing" | "error";

/**
 * Click-to-toggle voice input for the goal composer (before a session
 * exists). The in-session path is usePushToTalk; this one is deliberately
 * simpler — no barge-in, no hold timing — but it must still never leave the
 * microphone open.
 */
export function useVoice(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    // A second click while recording used to open a second stream and drop
    // the reference to the first, leaving it open for the rest of the run.
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        // The mic is done the moment recording stops — release it before the
        // transcription round trip, not after.
        releaseMic();
        setState("transcribing");
        try {
          const blob = new Blob(chunksRef.current, { type: mime });
          chunksRef.current = [];
          if (blob.size === 0) {
            setState("idle");
            return;
          }
          const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
          const result = await api().whisper.transcribe({
            audioBase64: base64,
            mimeType: mime,
          });
          if ("__error" in (result as object)) {
            const err = result as { __error: string; message?: string };
            setError(
              err.__error === "missing_openai_key"
                ? "OpenAI API key not configured."
                : (err.message ?? "Transcription failed."),
            );
            setState("error");
            return;
          }
          const text = (result as { text: string }).text.trim();
          if (text) onTranscriptRef.current(text);
          setState("idle");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setState("error");
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
    } catch (e) {
      releaseMic();
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, [releaseMic]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  // The goal screen unmounts on its own once the plan is ready. If that
  // happens mid-recording, the mic must not stay open for the whole session.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch {
          // already stopped
        }
      }
      releaseMic();
    };
  }, [releaseMic]);

  return { state, error, start, stop };
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
