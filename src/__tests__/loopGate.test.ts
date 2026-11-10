import { describe, it, expect } from "vitest";
import { shouldCallClaude } from "../lib/loopGate";

const base = {
  reason: "backstop" as const,
  requireScreenChange: true,
  screenChanged: false,
  screenDistance: 0,
  hasPendingFollowUp: false,
  stalled: false,
};

describe("session loop tick gate", () => {
  it("proceeds when the screen changed", () => {
    const r = shouldCallClaude({ ...base, screenChanged: true, screenDistance: 12 });
    expect(r.proceed).toBe(true);
    expect(r.why).toContain("screen-changed");
  });

  it("proceeds on a pending follow-up even with no screen change", () => {
    const r = shouldCallClaude({ ...base, hasPendingFollowUp: true });
    expect(r.proceed).toBe(true);
    expect(r.why).toBe("follow-up");
  });

  it("proceeds when stalled", () => {
    const r = shouldCallClaude({ ...base, stalled: true });
    expect(r.proceed).toBe(true);
    expect(r.why).toBe("stalled");
  });

  it("input tick with a sub-threshold pixel nudge proceeds (the comparator can miss small clicks)", () => {
    const r = shouldCallClaude({ ...base, reason: "input", screenDistance: 1 });
    expect(r.proceed).toBe(true);
    expect(r.why).toContain("input-nudge");
  });

  it("input tick with zero pixel movement is skipped (mouse travel only)", () => {
    const r = shouldCallClaude({ ...base, reason: "input", screenDistance: 0 });
    expect(r.proceed).toBe(false);
  });

  it("backstop tick with no change and no stall is skipped", () => {
    const r = shouldCallClaude(base);
    expect(r.proceed).toBe(false);
    expect(r.why).toContain("no-change");
  });
});
