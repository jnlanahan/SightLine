// Which remembered facts are worth putting in front of the agent.
//
// Recall has to be selective. Every fact costs tokens on every tick of the
// session, and an irrelevant one is worse than useless — it invites the coach
// to bring up something the user never asked about. So this ranks facts
// against the current goal and hands back only a small, high-confidence set.
//
// Pure module — no Electron, no fs, no clock of its own (the caller passes
// `now`) — so the ranking is deterministic and unit-testable.

import type { MemoryFact, MemoryKind } from "./db/schema";

/** Facts to attach to a session at most. Beyond this, recall becomes noise. */
export const MAX_RECALLED_FACTS = 6;

// Words carrying no signal for topical overlap.
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "for",
  "with", "my", "me", "i", "is", "are", "was", "were", "be", "been", "it",
  "this", "that", "how", "do", "does", "did", "can", "want", "need", "get",
  "got", "set", "up", "you", "your", "from", "by", "as", "into", "then",
  "there", "their", "they", "we", "our", "use", "using", "so", "if", "when",
]);

/** Lowercased, de-punctuated content words. */
export function keywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

// How much a kind is worth once it IS relevant.
const KIND_WEIGHT: Record<MemoryKind, number> = {
  setup: 1.0,
  preference: 0.9,
  obstacle: 0.6,
  history: 0.5,
};

// How relevant a kind is even with zero topical overlap. Knowing which machine
// and account someone is on helps on every task, so setup and preference carry
// a high floor; a note about one specific past obstacle or action only earns
// its place when the topic actually matches.
const KIND_FLOOR: Record<MemoryKind, number> = {
  setup: 0.55,
  preference: 0.5,
  obstacle: 0.15,
  history: 0.1,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A fact untouched for this long has effectively decayed to its floor.
const RECENCY_HALF_LIFE_DAYS = 30;
// Even a stale fact keeps some weight — "they use the desktop app" doesn't
// stop being true because it's been a month.
const RECENCY_FLOOR = 0.35;

export function recencyScore(fact: MemoryFact, now: number): number {
  const ageDays = Math.max(0, (now - fact.lastUsedAt) / DAY_MS);
  const decayed = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decayed;
}

// Facts that keep proving useful should keep surfacing, but the benefit has
// to saturate or a single early fact would dominate forever.
export function usefulnessScore(fact: MemoryFact): number {
  return 1 + Math.min(fact.useCount, 10) / 10;
}

/** Topical overlap between a fact and the current goal, 0-1. */
export function overlapScore(fact: MemoryFact, goalWords: Set<string>): number {
  if (goalWords.size === 0) return 0;
  const factWords = keywords(fact.content);
  if (factWords.size === 0) return 0;
  let hits = 0;
  for (const w of factWords) if (goalWords.has(w)) hits++;
  // Normalized against the smaller set so a long fact isn't penalized for
  // containing words the short goal never had a chance to mention.
  return hits / Math.min(factWords.size, goalWords.size);
}

export function scoreFact(
  fact: MemoryFact,
  goalWords: Set<string>,
  now: number,
): number {
  // Topical overlap, floored by how useful this kind is regardless of topic.
  const relevance = Math.max(overlapScore(fact, goalWords), KIND_FLOOR[fact.kind]);
  return (
    relevance *
    KIND_WEIGHT[fact.kind] *
    recencyScore(fact, now) *
    usefulnessScore(fact)
  );
}

// Below this a fact is more likely to distract than help. Calibrated against
// the scale above: a setup fact with no topical overlap scores ~0.54 and a
// topically-matching obstacle ~0.20, while a stale unrelated history note
// lands near 0.05. Set this too high — the original mistake — and genuinely
// relevant memory gets silently discarded, which reads to the user as the
// coach having forgotten everything.
const MIN_SCORE = 0.15;
// A fact that DOES share words with the goal is kept on a much lower bar.
// Obstacles and history carry a low kind weight by design, so a three-month-
// old "their VPN blocks the sync port" scores ~0.07 against "fix VPN upload
// failures" — below MIN_SCORE — while an unrelated setup fact sails through
// on its floor. Topical relevance is the whole point of remembering an
// obstacle; the floor-based cutoff should only gate the untopical ones.
const MIN_TOPICAL_SCORE = 0.05;

/**
 * The facts worth telling the agent about, best first. Archived facts are
 * never returned — the user removed them deliberately.
 */
export function selectFacts(
  facts: readonly MemoryFact[],
  goal: string,
  now: number,
  limit = MAX_RECALLED_FACTS,
): MemoryFact[] {
  const goalWords = keywords(goal);
  return facts
    .filter((f) => !f.archived && f.content.trim().length > 0)
    .map((f) => ({
      fact: f,
      score: scoreFact(f, goalWords, now),
      topical: overlapScore(f, goalWords) > 0,
    }))
    .filter((s) => s.score >= (s.topical ? MIN_TOPICAL_SCORE : MIN_SCORE))
    .sort((a, b) =>
      // Deterministic: break score ties by recency, then by id, so the same
      // inputs always produce the same prompt (and the same cache prefix).
      b.score !== a.score
        ? b.score - a.score
        : b.fact.lastUsedAt !== a.fact.lastUsedAt
          ? b.fact.lastUsedAt - a.fact.lastUsedAt
          : a.fact.id.localeCompare(b.fact.id),
    )
    .slice(0, limit)
    .map((s) => s.fact);
}

/**
 * Whether a candidate fact is already known. Compares on normalized content
 * words rather than exact text, because the agent will phrase the same fact
 * differently each time it notices it.
 */
export function isDuplicateFact(
  candidate: string,
  existing: readonly MemoryFact[],
): boolean {
  const candidateWords = keywords(candidate);
  if (candidateWords.size === 0) return true; // nothing to remember
  for (const fact of existing) {
    const factWords = keywords(fact.content);
    if (factWords.size === 0) continue;
    let hits = 0;
    for (const w of candidateWords) if (factWords.has(w)) hits++;
    const similarity = hits / Math.max(candidateWords.size, factWords.size);
    if (similarity >= 0.7) return true;
  }
  return false;
}

/** Render the selected facts for the agent's context header. */
export function formatFactsForPrompt(facts: readonly MemoryFact[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f) => `- (${f.kind}) ${f.content}`);
  return (
    "What you already know about this user from previous sessions:\n" +
    lines.join("\n") +
    "\nUse these to skip questions you already know the answer to. Do not " +
    "recite them back at the user, and do not assume they are still true if " +
    "the screen says otherwise."
  );
}
