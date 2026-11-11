import { describe, it, expect } from "vitest";

import { coachAgent } from "../../electron/agents/coach";
import { speechSkill } from "../../electron/agents/skills/speech";
import { systemPrompt } from "../../electron/agents/harness/schema";

// Load-bearing prompt phrases, locked so removing one is a deliberate
// decision rather than a side effect. The voice rules are the `speech` skill;
// the never-dead-air rules are the coach's situational guidance.

const voiceRules = speechSkill.systemFragment ?? "";
const coachPrompt = systemPrompt(coachAgent);

describe("shared voice rules", () => {
  it("contains 'One action per response'", () => {
    expect(voiceRules).toContain("One action per response");
  });

  it("contains 'end on a natural landing point'", () => {
    expect(voiceRules).toContain("natural landing point");
  });

  it("keeps responses short (60-word cap)", () => {
    expect(voiceRules).toContain("never more than 60 words");
  });

  it("asks for one idea per sentence (chunked-TTS friendly)", () => {
    expect(voiceRules).toContain("One idea per sentence");
  });

  // The first live run: seven step lines opened "Nice, …", most narrated what
  // had just happened on screen, and the verdict was "so unnatural". The
  // rules used to ask for exactly that (a stock list of openers, a 2-4 word
  // acknowledgement on every step, "light sarcasm").
  it("asks for plain speech, not a pat on the back every step", () => {
    expect(voiceRules).toContain("Don't praise every step");
    expect(voiceRules).toContain('Never open with "Nice"');
    expect(voiceRules).toContain("Start with the thing itself");
    expect(voiceRules).toContain("Warm, but plain");
    expect(voiceRules).not.toContain("Vary your openers");
    expect(voiceRules).not.toContain("light sarcasm");
  });

  it("nothing else in the prompt asks for the acknowledgement back", () => {
    expect(coachPrompt).not.toContain("2-4 word");
    expect(coachPrompt).not.toContain("Nice, that's in");
    expect(coachAgent.nextTurnPrompt).not.toContain("acknowledge in a few words");
  });

  it("reaches the coach's prompt", () => {
    // The voice is the product. An agent that silently lost these rules would
    // still work and would sound like a different app.
    expect(coachPrompt).toContain("One idea per sentence");
  });
});

describe("coach — pacing", () => {
  it("contains pacing instruction", () => {
    expect(coachPrompt).toContain("one concrete step at a time");
  });
});

describe("coach — never-dead-air rules", () => {
  it("first turn forces a spoken first step", () => {
    const { sessionStart } = coachAgent.guidance;
    // (The tech support agent's guidance opened "The session just started";
    // the coach's opens "This is your first look". The rules below are what
    // make the first turn speak, and both agents carry them.)
    expect(sessionStart).toContain("This is your first look");
    expect(sessionStart).toContain("Do not call wait");
    expect(sessionStart).toContain("do not set digression=true");
  });

  it("stall check-in mentions the wrong-monitor possibility", () => {
    expect(coachAgent.guidance.stalled).toContain("which screen or monitor");
  });

  it("stall guidance checks for completed steps before waiting", () => {
    expect(coachAgent.guidance.stalled).toContain(
      "if the user already completed that step, give the NEXT step now",
    );
  });
});
