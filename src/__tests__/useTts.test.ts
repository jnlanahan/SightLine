import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC bridge before importing the module under test. The cloud path
// always fails here, so every stream exercises the fallback + drain logic.
const speakMock = vi.fn();
vi.mock("../lib/api", () => ({
  api: () => ({
    tts: {
      speak: speakMock,
    },
    log: vi.fn(),
  }),
}));

describe("waitForSpeechEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speakMock.mockResolvedValue({ __error: "not available in test" });
  });

  it("is exported from useTts", async () => {
    const mod = await import("../hooks/useTts");
    expect(typeof mod.waitForSpeechEnd).toBe("function");
  });

  it("resolves immediately when nothing is playing (initial state)", async () => {
    const { waitForSpeechEnd } = await import("../hooks/useTts");
    // Should resolve without hanging — no audio is playing at module init.
    await expect(waitForSpeechEnd()).resolves.toBeUndefined();
  });

  it("resolves after cancel() is called", async () => {
    const { useTts, waitForSpeechEnd } = await import("../hooks/useTts");
    const { speak, cancel } = useTts();

    speak("hello world");
    // Promise is now pending (audio IPC call is in-flight)
    const done = waitForSpeechEnd();

    // Cancelling should resolve the promise immediately.
    cancel();

    // Should resolve now, not hang.
    await expect(done).resolves.toBeUndefined();
  });

  it("resolves when audio IPC fails (falls back to web speech or no-op)", async () => {
    const { useTts, waitForSpeechEnd } = await import("../hooks/useTts");
    const { speak } = useTts();

    speak("test fallback");
    const done = waitForSpeechEnd();

    // The mocked api returns an error, so the cloud path fails and the
    // stream drains through the fallback path.
    await expect(done).resolves.toBeUndefined();
  });
});

describe("cancelled streams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speakMock.mockResolvedValue({ __error: "not available in test" });
  });

  it("does not synthesize chunks enqueued after the stream was cancelled", async () => {
    const { openSpeechStream } = await import("../hooks/useTts");
    const stream = openSpeechStream();
    stream.enqueue("First sentence.");
    // A barge-in / new stream cancels the first one…
    const next = openSpeechStream();
    // …so anything the first stream still tries to say is dropped silently.
    stream.enqueue("Stale sentence that must never be synthesized.");
    stream.end();
    next.end();
    await new Promise((r) => setTimeout(r, 0));
    const texts = speakMock.mock.calls.map((c) => String(c[0]));
    expect(texts).not.toContain("Stale sentence that must never be synthesized.");
  });

  it("passes the earlier sentences of a response as context for the later ones", async () => {
    const { openSpeechStream, waitForSpeechEnd } = await import("../hooks/useTts");
    const stream = openSpeechStream();
    stream.enqueue("See the blue button?");
    stream.enqueue("Click that.");
    stream.end();
    await waitForSpeechEnd(2_000);
    const calls = speakMock.mock.calls.map((c) => [String(c[0]), String(c[1])]);
    expect(calls).toContainEqual(["See the blue button?", ""]);
    expect(calls).toContainEqual(["Click that.", "See the blue button?"]);
  });
});

describe("THINKING_PHRASES", () => {
  it("has several fillers so the coach doesn't repeat itself", async () => {
    const { THINKING_PHRASES } = await import("../hooks/useTts");
    expect(THINKING_PHRASES.length).toBeGreaterThanOrEqual(3);
  });

  it("all phrases are short enough to play while Claude thinks", async () => {
    const { THINKING_PHRASES } = await import("../hooks/useTts");
    for (const phrase of THINKING_PHRASES) {
      const wordCount = phrase.split(/\s+/).length;
      expect(wordCount, `"${phrase}" is too long (${wordCount} words)`).toBeLessThanOrEqual(8);
    }
  });
});
