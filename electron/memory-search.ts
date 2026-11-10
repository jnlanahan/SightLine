// Searching the past: what the coach reaches for when the user says "like we
// did last time", or the problem on screen looks like one met before.
//
// Only a small, ranked slice of memory rides along on every look (see
// memory-rank.ts). Everything else — other chats' goals, notes, step logs and
// transcripts, and the facts that did not make the cut — is reachable on
// demand through the search_memory tool, which lands here.
//
// Plain keyword search. The volume is a few hundred small chats, so an index
// or embeddings would be machinery with nothing to do.
//
// Pure module — no Electron, no fs, no clock of its own (the caller passes
// `now`) — so the ranking is deterministic and unit-testable.

import type { ChatRecord, ChatSummary, MemoryFact } from "./db/schema";
import { keywords } from "./memory-rank";

/** Results handed back per search at most. More is noise the user waits on. */
export const MAX_SEARCH_RESULTS = 5;
/** Characters of context returned per result at most, ellipses included. */
export const MAX_SNIPPET_CHARS = 300;
/** Chat files read per search at most: the most recently active ones. */
export const MAX_CHATS_SEARCHED = 100;

/** Where in a chat a match was found. */
export type ChatField =
  | "title"
  | "goal"
  | "note"
  | "whereWeLeftOff"
  | "stepLog"
  | "transcript";

export type MemorySearchHit =
  | {
      source: "fact";
      factId: string;
      factKind: MemoryFact["kind"];
      snippet: string;
      score: number;
    }
  | {
      source: "chat";
      chatId: string;
      title: string;
      lastActiveAt: number;
      field: ChatField;
      snippet: string;
      score: number;
    };

// A match in what the chat is ABOUT says more than the same words turning up
// somewhere in a long transcript. These only order matches against each
// other; any hit at all is enough to be returned.
const FIELD_WEIGHT: Record<ChatField, number> = {
  title: 1.0,
  goal: 1.0,
  note: 0.9,
  whereWeLeftOff: 0.8,
  stepLog: 0.7,
  transcript: 0.5,
};
// Facts are short and deliberately kept; a match in one is a strong match.
const FACT_WEIGHT = 0.9;

// Recency only breaks near-ties: a chat from a year ago keeps 85% of its
// score, so a much better old match still beats a weak recent one.
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_DAYS = 60;
const RECENCY_FLOOR = 0.85;

function recencyFactor(at: number, now: number): number {
  const ageDays = Math.max(0, (now - at) / DAY_MS);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

// A light stem so "uploads", "uploading" and "uploaded" find "upload". Only
// ever strips a suffix while keeping at least three letters.
function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of keywords(text)) out.add(stem(w));
  return out;
}

interface Match {
  score: number;
  // The query stems this text contains, for placing the snippet.
  matched: string[];
}

function matchText(text: string, query: Set<string>, weight: number): Match | null {
  if (!text.trim()) return null;
  const words = stems(text);
  const matched = [...query].filter((q) => words.has(q));
  if (matched.length === 0) return null;
  return { score: (matched.length / query.size) * weight, matched };
}

/**
 * At most MAX_SNIPPET_CHARS of `text` around the first place a matched word
 * appears, whitespace collapsed, with an ellipsis on any side that was cut.
 */
export function snippetAround(text: string, matched: readonly string[]): string {
  const flat = text.trim().replace(/\s+/g, " ");
  if (flat.length <= MAX_SNIPPET_CHARS) return flat;

  const lower = flat.toLowerCase();
  let at = -1;
  for (const m of matched) {
    const i = lower.indexOf(m);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) at = 0;

  // Leave room for an ellipsis on both sides.
  const room = MAX_SNIPPET_CHARS - 2;
  let start = Math.max(0, at - Math.floor(room / 3));
  const end = Math.min(flat.length, start + room);
  start = Math.max(0, end - room);
  return (
    (start > 0 ? "…" : "") +
    flat.slice(start, end).trim() +
    (end < flat.length ? "…" : "")
  );
}

/**
 * The best match anywhere in one chat, or null if nothing matched. The score
 * is the best field's; the text and field are what the snippet is cut from.
 */
function bestChatMatch(
  chat: ChatRecord,
  query: Set<string>,
): { field: ChatField; text: string; match: Match } | null {
  const candidates: Array<{ field: ChatField; text: string }> = [
    { field: "title", text: chat.title ?? "" },
    { field: "goal", text: chat.goal ?? "" },
    { field: "whereWeLeftOff", text: chat.whereWeLeftOff ?? "" },
  ];
  for (const note of chat.notes ?? []) {
    // A retired note was forgotten by the user or pushed out by the cap; the
    // coach must not find it again by searching.
    if (note && note.retiredAt == null) candidates.push({ field: "note", text: note.text ?? "" });
  }
  for (const entry of chat.stepLog ?? []) {
    candidates.push({ field: "stepLog", text: entry?.text ?? "" });
  }
  for (const turn of chat.turns ?? []) {
    if (!turn) continue;
    const who = turn.role === "user" ? "User" : "Coach";
    const body = [turn.content, turn.code].filter(Boolean).join("\n");
    candidates.push({ field: "transcript", text: body ? `${who}: ${body}` : "" });
  }

  let best: { field: ChatField; text: string; match: Match } | null = null;
  // The snippet comes from the best match OUTSIDE the title: the title is
  // already shown with the result, so repeating it tells the coach nothing.
  let bestBody: { field: ChatField; text: string; match: Match } | null = null;
  for (const c of candidates) {
    const match = matchText(c.text, query, FIELD_WEIGHT[c.field]);
    if (!match) continue;
    // Strictly greater: on a tie the earlier, more summary-like field wins.
    if (!best || match.score > best.match.score) best = { ...c, match };
    if (c.field !== "title" && (!bestBody || match.score > bestBody.match.score)) {
      bestBody = { ...c, match };
    }
  }
  if (!best) return null;
  if (bestBody) {
    return { ...bestBody, match: { ...bestBody.match, score: best.match.score } };
  }
  // Only the title matched: show where the chat was left, or its goal.
  const context = [
    { field: "whereWeLeftOff" as const, text: chat.whereWeLeftOff ?? "" },
    { field: "goal" as const, text: chat.goal ?? "" },
  ].find((c) => c.text.trim());
  return context ? { ...context, match: best.match } : best;
}

export interface MemorySearchInput {
  query: string;
  facts: readonly MemoryFact[];
  chats: readonly ChatRecord[];
  /** The chat the coach is in now. Never returned: it already has all of it. */
  currentChatId: string | null;
  now: number;
  /**
   * The memory already loaded into this chat (the recalled-facts block).
   * A fact whose text is in it is skipped — the coach can already see it.
   */
  alreadyLoaded?: string;
  limit?: number;
}

/** The best matches for `query` across facts and saved chats, best first. */
export function searchMemory(input: MemorySearchInput): MemorySearchHit[] {
  const query = stems(input.query ?? "");
  if (query.size === 0) return [];
  const limit = Math.max(0, Math.min(input.limit ?? MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS));
  const loaded = input.alreadyLoaded ?? "";

  const hits: MemorySearchHit[] = [];

  for (const fact of input.facts) {
    if (!fact || fact.archived) continue;
    const content = (fact.content ?? "").trim();
    if (!content || (loaded && loaded.includes(content))) continue;
    const match = matchText(content, query, FACT_WEIGHT);
    if (!match) continue;
    hits.push({
      source: "fact",
      factId: fact.id,
      factKind: fact.kind,
      snippet: snippetAround(content, match.matched),
      score: match.score * recencyFactor(fact.lastUsedAt, input.now),
    });
  }

  for (const chat of input.chats) {
    if (!chat || chat.id === input.currentChatId) continue;
    const best = bestChatMatch(chat, query);
    if (!best) continue;
    hits.push({
      source: "chat",
      chatId: chat.id,
      title: chat.title,
      lastActiveAt: chat.lastActiveAt,
      field: best.field,
      snippet: snippetAround(best.text, best.match.matched),
      score: best.match.score * recencyFactor(chat.lastActiveAt, input.now),
    });
  }

  const at = (h: MemorySearchHit) => (h.source === "chat" ? h.lastActiveAt : 0);
  const id = (h: MemorySearchHit) => (h.source === "chat" ? h.chatId : h.factId);
  return hits
    .sort((a, b) =>
      // Deterministic: score, then the more recent chat, then id.
      b.score !== a.score
        ? b.score - a.score
        : at(b) !== at(a)
          ? at(b) - at(a)
          : id(a).localeCompare(id(b)),
    )
    .slice(0, limit);
}

/**
 * Which chat files a search reads: the most recently active ones from the
 * index, the current chat left out, at most MAX_CHATS_SEARCHED. Reading every
 * saved chat on every call would be wasteful once there are hundreds.
 */
export function chatsToSearch(
  index: readonly ChatSummary[],
  currentChatId: string | null,
  limit = MAX_CHATS_SEARCHED,
): string[] {
  return [...index]
    .filter((c) => c && c.id !== currentChatId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, limit)
    .map((c) => c.id);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function describeWhen(at: number, now: number): string {
  const d = new Date(at);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const days = Math.floor(Math.max(0, now - at) / DAY_MS);
  const ago = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return `${date}, ${ago}`;
}

const FIELD_LABEL: Record<ChatField, string> = {
  title: "title",
  goal: "goal",
  note: "your note",
  whereWeLeftOff: "where it was left",
  stepLog: "step done",
  transcript: "conversation",
};

/** The tool result the coach reads. Plain text, one block per result. */
export function formatSearchResults(
  query: string,
  hits: readonly MemorySearchHit[],
  now: number,
): string {
  if (hits.length === 0) {
    return `Nothing in earlier chats or saved facts matches "${query}". Carry on from what you can see; don't tell the user you searched unless they asked.`;
  }
  const blocks = hits.map((h, i) =>
    h.source === "fact"
      ? `${i + 1}. Saved fact about the user (${h.factKind}): ${h.snippet}`
      : `${i + 1}. Chat "${h.title}" (last active ${describeWhen(h.lastActiveAt, now)}), ${FIELD_LABEL[h.field]}: ${h.snippet}`,
  );
  return (
    `Earlier chats and facts matching "${query}", best first:\n` +
    blocks.join("\n") +
    "\nUse what helps in your own words — don't read these back as a list."
  );
}
