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
  it("does not use a microphone icon for the coach's voice", async () => {
    // A microphone means input. This toggle controls output, and the
    // hold-to-talk mic sits directly above it in the composer — two mic icons
    // with opposite meanings is how the app got muted by accident.
    const src = await source("../App");
    const controlBar = src.slice(src.indexOf("function ControlBar"));
    const voiceToggle = controlBar.slice(0, controlBar.indexOf("AttachIcon"));
    expect(voiceToggle).not.toContain("<IMic");
    expect(voiceToggle).toContain("Speaker");
  });

  it("says MUTED in words, not just a colour change", async () => {
    const src = await source("../App");
    expect(src).toContain("MUTED");
  });
});
