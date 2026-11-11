// Regression guards for timing constants.
// These lock in the agreed values so any future change is intentional.
import { describe, it, expect } from "vitest";

// We test the values via the module source since the constants are not
// exported. The real guard is: if someone changes a value, this test breaks
// and forces a deliberate decision.

async function loopSource(): Promise<string> {
  const src = await import("../hooks/useSessionLoop?raw");
  return (src as unknown as { default: string }).default;
}

describe("timing constants (regression guards)", () => {
  // The cadence lives on the coach (electron/agents/coach.ts → Agent.loop and
  // loopByStance) and its values are asserted against the agent object in
  // coach.test.ts — a stronger guard than grepping source text.
  //
  // What stays here is the loop EXECUTOR's own behaviour: the guards, the
  // gates, and the hysteresis that belong to the scheduler rather than to any
  // one agent.

  it("CHECK_IN_REPEAT_MS is 60000", async () => {
    expect(await loopSource()).toContain("CHECK_IN_REPEAT_MS = 60_000");
  });

  it("follow-ups bypass the minimum call spacing", async () => {
    expect(await loopSource()).toContain("!state.pendingFollowUp");
  });

  it("DIVERTED_STALL_MS is 120000", async () => {
    expect(await loopSource()).toContain("DIVERTED_STALL_MS = 120_000");
  });

  it("a digression can no longer suppress stall check-ins forever", async () => {
    expect(await loopSource()).toContain(
      "(!s0.diverted || sinceChangeMs >= DIVERTED_STALL_MS)",
    );
  });

  it("first tick after session start is flagged (guaranteed first step)", async () => {
    expect(await loopSource()).toContain("sessionJustStarted");
  });

  // The quiet period is only safe to shorten because speech is gated
  // separately. If either guard is removed, a fast tick would cut the coach
  // off mid-sentence — the exact bug that made the app feel like it was
  // talking over the user.
  it("a quiet-period tick never fires while the coach is speaking", async () => {
    const src = await loopSource();
    expect(src).toContain("if (isSpeaking()) return;");
  });

  it("the backstop chain waits for speech to finish before ticking", async () => {
    expect(await loopSource()).toContain("await waitForSpeechEnd();");
  });
});

describe("the coach never talks over itself or ignores the user", () => {
  // Repeats have to be caught in the chunk handler. The post-response dedupe
  // still exists as a backstop, but by the time it runs every sentence has
  // already been enqueued for playback — suppressing there is too late to
  // stop the user hearing it.
  it("repeat suppression runs on streamed chunks, not just the final result", async () => {
    const src = await loopSource();
    expect(src).toContain("isRepeatedSentence(chunk.text, previousInstruction)");
  });

  it("withheld chunks are not re-spoken by the end-of-response fallback", async () => {
    const src = await loopSource();
    expect(src).toContain("if (!earlySpoken && !suppressedRepeat)");
  });

  // A follow-up is an explicit question. Neither anti-repetition guard may
  // apply to it: saying an answer again because the user asked is correct,
  // and a silent turn leaves them hanging after the filler already played.
  it("a follow-up turn is exempt from repeat suppression", async () => {
    const src = await loopSource();
    expect(src).toContain("const answeringFollowUp = Boolean(followUp);");
    // Both guards key off `prompted`, which a follow-up always sets.
    expect(src).toContain("const prompted = answeringFollowUp || Boolean(resuming);");
    expect(src).toContain("if (!prompted && isRepeatedSentence(");
    expect(src).toMatch(/!prompted &&\s+action === "instruct"/);
  });

  // The greeting on reopening a chat names the step the user was on, which is
  // exactly what the repeat guards would otherwise swallow.
  it("the resume greeting is exempt too, and fires exactly once", async () => {
    const src = await loopSource();
    expect(src).toContain("const resuming = s.resumePending ?? undefined;");
    expect(src).toContain("if (resuming) useSession.getState().setResumePending(null);");
  });

  // A look that fails, throws, or is thrown away has greeted nobody. The
  // greeting used to be spent the moment the look started.
  it("a greeting that was never delivered is handed back for the next look", async () => {
    const src = await loopSource();
    expect(src).toContain("undeliveredResume = { chatId: sessionId, resume: resuming };");
    expect(src).toContain("useSession.getState().setResumePending(undeliveredResume.resume);");
    // Cleared only once the answer is actually being applied.
    expect(src.indexOf("undeliveredResume = null;")).toBeGreaterThan(
      src.indexOf("result discarded: session"),
    );
  });

  it("a greeting answered with silence is recovered into something spoken", async () => {
    const src = await loopSource();
    expect(src).toContain('if (resuming && !answeringFollowUp && action === "wait")');
  });

  // Leave a chat mid-look, open another: the old chain used to throw the
  // answer away and then sleep 15-60 s before its first look at the new chat.
  it("a chat opened mid-look is looked at straight away, not after a sleep", async () => {
    const src = await loopSource();
    expect(src).toContain("const chatBefore = useSession.getState().sessionId;");
    expect(src).toContain("if (useSession.getState().sessionId !== chatBefore) continue;");
  });

  it("a new chat or a new stance cuts short a sleep chosen for the old one", async () => {
    const src = await loopSource();
    expect(src).toMatch(
      /state\.sessionId !== prev\.sessionId \|\| state\.stance !== prev\.stance\) \{\s+cancelSleep\?\.\(\);/,
    );
  });

  it("wandering off never erases the plan", async () => {
    const src = await loopSource();
    expect(src).toMatch(
      /if \(!result\.digression\) \{\s+useSession\.getState\(\)\.setUpcomingSteps\(/,
    );
  });

  // Once the coach has said the goal back, a look before the user answers
  // could only produce a step nobody agreed to. Their answer (a follow-up)
  // and the greeting on reopening a chat still go through.
  it("holds its looks while the goal is waiting on the user's yes", async () => {
    const src = await loopSource();
    expect(src).toContain(
      "if (state.goalPending && !state.pendingFollowUp && !state.resumePending) {",
    );
    // Ahead of the capture: nothing is looked at, and nothing is paid for.
    expect(src.indexOf("state.goalPending && !state.pendingFollowUp")).toBeLessThan(
      src.indexOf("api().capture.once("),
    );
  });

  it("the coach's own action settles the goal, never a guess at the user's words", async () => {
    const src = await loopSource();
    expect(src).toContain('if (result.action === "confirm_goal") {');
    expect(src).toContain(
      'else if (useSession.getState().goalPending && result.action !== "wait") {',
    );
  });

  // "Nailed it, you're all set." used to be bolted on after the coach's own
  // wrap-up. The coach's words are the ending now.
  it("adds no canned line after the coach says it is done", async () => {
    const src = await loopSource();
    expect(src).not.toContain("randomCompletionPhrase");
    const runner = (await import("../../electron/agents/harness/runner?raw")) as unknown as {
      default: string;
    };
    expect(runner.default).not.toContain("2-4 word acknowledgment");
  });

  it("a follow-up that returns wait is recovered into something spoken", async () => {
    const src = await loopSource();
    expect(src).toContain('if (answeringFollowUp && action === "wait")');
    expect(src).toContain("randomNoAnswerPhrase()");
  });
});

describe("vision payload size (regression guards)", () => {
  // Each attached frame is ~1.2k tokens of prefill and lands directly on
  // time-to-first-token. Reduced from 3 to 2 in July 2026; raising it again
  // is a deliberate latency-for-context trade.
  it("MAX_FRAMES is 2", async () => {
    const src = await import("../../electron/agents/harness/runner?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "const MAX_FRAMES = 2",
    );
  });

  // A turn may now spend several round trips on tools before it speaks, and
  // every one of them is silence the user sits through. The cap is the
  // latency budget — raising it is a deliberate trade.
  it("the coach caps a turn at 3 iterations", async () => {
    const { coachAgent } = await import("../../electron/agents/coach");
    expect(coachAgent.maxToolIterations).toBe(3);
  });
});
