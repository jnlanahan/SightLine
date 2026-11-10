// The "how long until the coach's first words" clock. Its numbers are the
// speed baseline the one-coach work is measured against, so the bookkeeping
// has to be right: one report per ask, and never a filler counted as the answer.

import { beforeEach, describe, expect, it } from "vitest";
import {
  markAsk,
  resetAskClock,
  sinceAsk,
  takeAudioStart,
  takeFirstWords,
} from "../lib/askClock";

describe("ask clock", () => {
  beforeEach(() => resetAskClock());

  it("reports nothing when the user has not asked anything", () => {
    expect(sinceAsk(1_000)).toBeNull();
    expect(takeFirstWords(1_000)).toBeNull();
    expect(takeAudioStart(1_000)).toBeNull();
  });

  it("measures first words from the moment of the ask, once", () => {
    markAsk("goal", 1_000);
    expect(takeFirstWords(4_200)).toEqual({ kind: "goal", ms: 3_200 });
    expect(takeFirstWords(5_000)).toBeNull();
  });

  it("ignores audio that plays before the answer's first words", () => {
    // A thinking filler (or the old plan overview) starts playing first.
    markAsk("followup", 1_000);
    expect(takeAudioStart(1_050)).toBeNull();
    expect(takeFirstWords(3_000)).toEqual({ kind: "followup", ms: 2_000 });
    expect(takeAudioStart(3_400)).toEqual({ kind: "followup", ms: 2_400 });
  });

  it("closes the ask once its audio has started", () => {
    markAsk("goal", 0);
    takeFirstWords(100);
    takeAudioStart(200);
    expect(sinceAsk(300)).toBeNull();
    expect(takeAudioStart(400)).toBeNull();
  });

  it("a newer ask replaces an unanswered one", () => {
    markAsk("goal", 0);
    markAsk("followup", 5_000);
    expect(takeFirstWords(6_000)).toEqual({ kind: "followup", ms: 1_000 });
  });

  it("peeks without closing", () => {
    markAsk("goal", 0);
    expect(sinceAsk(700)).toEqual({ kind: "goal", ms: 700 });
    expect(takeFirstWords(900)).toEqual({ kind: "goal", ms: 900 });
  });
});
