// The one-tap replies: what each button sends to the coach. They are plain
// words, the same as typing or saying them, so the coach needs no special
// handling. They live here so the loop can tell "the user told me something"
// from "the user asked me something" and pick the spoken filler to match.

export const STEP_DONE_REPLY = "Done — what's next?";
export const CHECK_WORK_REPLY = "Check my work";
export const STUCK_REPLY = "I'm stuck";
export const GOAL_AGREED_REPLY = "Yes, that's the goal. Let's start.";

const QUICK_REPLIES = [
  STEP_DONE_REPLY,
  CHECK_WORK_REPLY,
  STUCK_REPLY,
  GOAL_AGREED_REPLY,
].map(normalize);

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/, "");
}

/**
 * True when a follow-up is one of the one-tap replies — tapped, typed or
 * spoken. Matching on the words, not on how they arrived, means saying "check
 * my work" out loud gets the same acknowledgement as tapping the button.
 */
export function isQuickReply(text: string): boolean {
  return QUICK_REPLIES.includes(normalize(text));
}
