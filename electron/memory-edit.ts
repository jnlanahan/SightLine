// The user correcting what the coach remembers about them.
//
// The pure half of the `memory:update` channel: given every fact and one
// change, work out the new list. main.ts reads and writes the file around it.
//
// Pure module — no Electron, no fs — so it is unit-testable.

import type { MemoryFact } from "./db/schema";
import { MAX_MEMORY_CHARS } from "./instruction-parse";

export interface FactUpdate {
  id: string;
  // New wording. Omit to leave the text alone.
  content?: string;
  // True marks the fact confirmed. Only confirming is offered: un-confirming
  // something the user said is true has no use, and forgetting is its own
  // action.
  verified?: true;
}

export type FactUpdateResult =
  | { ok: true; facts: MemoryFact[]; fact: MemoryFact }
  | { ok: false; reason: "not_found" | "forgotten" | "empty" | "too_long" | "nothing" };

export function applyFactUpdate(
  facts: readonly MemoryFact[],
  update: FactUpdate,
): FactUpdateResult {
  const current = facts.find((f) => f.id === update?.id);
  if (!current) return { ok: false, reason: "not_found" };
  // A forgotten fact stays forgotten. Editing it would quietly bring it back
  // into what the coach can recall.
  if (current.archived) return { ok: false, reason: "forgotten" };

  let content = current.content;
  if (typeof update.content === "string") {
    content = update.content.trim().replace(/\s+/g, " ");
    if (!content) return { ok: false, reason: "empty" };
    if (content.length > MAX_MEMORY_CHARS) return { ok: false, reason: "too_long" };
  }
  const verified = update.verified === true ? true : current.verified === true;
  if (content === current.content && verified === (current.verified === true)) {
    return { ok: false, reason: "nothing" };
  }

  const fact: MemoryFact = { ...current, content, verified };
  return {
    ok: true,
    fact,
    facts: facts.map((f) => (f.id === fact.id ? fact : f)),
  };
}
