import { describe, expect, it } from "vitest";
import {
  CHECK_WORK_REPLY,
  GOAL_AGREED_REPLY,
  STEP_DONE_REPLY,
  STUCK_REPLY,
  isQuickReply,
} from "../lib/quickReplies";

// A one-tap reply tells the coach something; it is not a question. The loop
// uses this to play a plain acknowledgement instead of a thinking filler.

describe("isQuickReply", () => {
  it("recognises every one-tap reply", () => {
    for (const reply of [STEP_DONE_REPLY, CHECK_WORK_REPLY, STUCK_REPLY, GOAL_AGREED_REPLY]) {
      expect(isQuickReply(reply)).toBe(true);
    }
  });

  it("recognises the same words typed or spoken", () => {
    expect(isQuickReply("check my work.")).toBe(true);
    expect(isQuickReply("  I'm stuck!  ")).toBe(true);
  });

  it("leaves a real question alone", () => {
    expect(isQuickReply("Where is the Export button?")).toBe(false);
    expect(isQuickReply("I'm stuck on the second field, what goes there?")).toBe(false);
  });
});
