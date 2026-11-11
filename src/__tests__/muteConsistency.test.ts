// Guards the "the coach won't read the step out loud" bug.
//
// Root cause: the session-plan overview was spoken WITHOUT checking
// `ttsEnabled`, while every other spoken line checked it. A muted app
// therefore talked exactly once — at session start — and then stayed silent
// for the rest of the session. That reads as "it won't read the steps out
// loud", not as "the voice is muted", which is why it survived so long.
//
// The invariant: if the coach is muted, it is muted everywhere. If it is not
// muted, it speaks everywhere.

import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  const mod = await import(/* @vite-ignore */ `${path}?raw`);
  return (mod as unknown as { default: string }).default;
}

describe("muting is consistent across every speech path", () => {
  it("the session loop gates every spoken line on ttsEnabled", async () => {
    const src = await source("../hooks/useSessionLoop");
    // speakOut is the single funnel for everything the coach says in-session.
    expect(src).toContain("const ttsOn = ()");
    expect(src).toContain("if (!ttsOn() || !text.trim()) return;");
  });

  it("streamed speech chunks are gated too", async () => {
    const src = await source("../hooks/useSessionLoop");
    // Early sentence-level TTS is a separate path into speech and needs the
    // same guard, or a muted app starts talking mid-stream.
    expect(src).toContain("onSpeechChunk((chunk) => {");
    expect(src).toMatch(/onSpeechChunk\(\(chunk\) => \{\s*\n\s*if \(!ttsOn\(\)\) return;/);
  });
});

describe("the mute control is legible", () => {
  // The voice toggle moved from the old bottom bar (ControlBar, removed in
  // redesign WP8) to the phase rail and, for a quick answer, the header. The
  // rules are the same; only the file they are checked in changed.
  it("does not use a microphone icon for the coach's voice", async () => {
    // A microphone means input. This toggle controls output, and the
    // hold-to-talk mic sits in the composer — two mic icons with opposite
    // meanings is how the app got muted by accident.
    for (const path of ["../components/PhaseRail", "../components/phase/PhaseHeader"]) {
      const src = await source(path);
      expect(src).not.toMatch(/Mic/);
      expect(src).toContain("IconSpeakerOff");
      expect(src).toContain("IconSpeaker ");
    }
  });

  it("says it is muted in words, not just an icon change", async () => {
    for (const path of ["../components/PhaseRail", "../components/phase/PhaseHeader"]) {
      const src = await source(path);
      expect(src).toContain('"Turn voice on"');
      expect(src).toContain('"Voice is muted"');
    }
  });
});
