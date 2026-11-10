// How long the user waits for the coach's first words.
//
// One "ask" is open at a time: a goal or a follow-up the user just submitted.
// The session loop reports the first words of the answer; the audio player
// reports when that answer actually became audible. Speech that is not the
// answer (a thinking filler, the old plan overview) never closes an ask —
// audio only counts once the answer's first words have been reported.
//
// Pure — the caller passes the clock — so the bookkeeping is unit-testable.

export type AskKind = "goal" | "followup";

export interface AskTiming {
  kind: AskKind;
  ms: number;
}

interface OpenAsk {
  kind: AskKind;
  at: number;
  wordsReported: boolean;
}

let open: OpenAsk | null = null;

/** The user just submitted something and is now waiting on the coach. A newer
 *  ask replaces an older one — the newest question is the one being waited on. */
export function markAsk(kind: AskKind, now: number): void {
  open = { kind, at: now, wordsReported: false };
}

/** Time since the open ask, without closing anything. */
export function sinceAsk(now: number): AskTiming | null {
  return open ? { kind: open.kind, ms: now - open.at } : null;
}

/** The answer's first words exist. Reports once per ask. */
export function takeFirstWords(now: number): AskTiming | null {
  if (!open || open.wordsReported) return null;
  open.wordsReported = true;
  return { kind: open.kind, ms: now - open.at };
}

/** Audio started playing. Reports once, only after the answer's first words,
 *  and closes the ask. */
export function takeAudioStart(now: number): AskTiming | null {
  if (!open || !open.wordsReported) return null;
  const timing = { kind: open.kind, ms: now - open.at };
  open = null;
  return timing;
}

/** Test hook. */
export function resetAskClock(): void {
  open = null;
}
