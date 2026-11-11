// Tidy-up: what the coach does with a chat after the user has left it.
//
// While a chat is live, memory is written in the moment — a note here, a fact
// there — and the where-we-left-off line is built mechanically from the step
// log. That is fast and never wrong, but it accumulates: near-duplicate notes,
// a goal-as-typed for a title, a summary that lists steps without saying
// where things actually stand. One small background call per left chat fixes
// that: a proper title, a two-sentence summary, merged notes, and anything
// durable about the user promoted to a fact.
//
// The model only PROPOSES. Everything it returns goes through the fixed
// checks in applyTidy() before a byte is written, and a result that fails
// them leaves the chat exactly as it was. Nothing the user edited by hand is
// ever altered.
//
// Pure module — no Electron, no fs, no clock of its own — so the checks are
// unit-testable. The call itself lives in claude.ts.

import { addNote, forgetNote, liveNotes } from "./chat-notes";
import type { ChatRecord, ChatTidy, MemoryFact, MemoryKind } from "./db/schema";
import { isDuplicateFact } from "./memory-rank";

/** New turns a chat needs since its last tidy before another is worth a call. */
export const TIDY_MIN_NEW_TURNS = 4;

const MAX_TITLE_CHARS = 60;
const MAX_SUMMARY_CHARS = 320;
const MAX_CHANGED_CHARS = 200;
const MAX_NOTE_CHARS = 200;
const MAX_FACT_CHARS = 200;
const MAX_ADDED_NOTES = 4;
const MAX_NEW_FACTS = 3;
// How much of the transcript one tidy reads. A very long chat is tidied from
// its recent end; the earlier part was covered by an earlier tidy.
const MAX_TURNS_READ = 60;
const MAX_TURN_CHARS = 600;

const FACT_KINDS: readonly MemoryKind[] = ["setup", "preference", "history", "obstacle"];

// Nothing that looks like a credential or a payment detail is ever written to
// memory by the tidy-up, whatever the model returns.
const SENSITIVE =
  /pass(word|code|phrase)|\bpin\b|security (answer|question)|social security|\bssn\b|card number|\bcvv\b|\bcvc\b|api[ _-]?key|secret key|\b\d{13,19}\b/i;

export function looksSensitive(text: string): boolean {
  return SENSITIVE.test(text);
}

/** Whether enough has happened in a chat since its last tidy to do another. */
export function needsTidy(record: Pick<ChatRecord, "turns" | "tidy">): boolean {
  const tidiedAt = record.tidy?.turns ?? 0;
  return record.turns.length - tidiedAt >= TIDY_MIN_NEW_TURNS;
}

// ── What the model is asked ──

export const TIDY_SYSTEM = `You tidy the records of a screen-watching coach after the user has left a chat. You are not talking to the user and nothing you write is spoken. You return JSON only.

You are given one chat: its goal, its plan, the steps logged as done, the coach's notes (each with an id), what the coach already knows about this user, and the recent conversation. Produce:

- "title": a short name for the chat, under 8 words, saying what it is about ("VPN setup on the work laptop"). Not a sentence, no quotes.
- "where_we_left_off": one or two plain sentences on where things stand and what comes next, written so the user recognises the chat at a glance and the coach can pick it up cold. Say what is true, not what was hoped. If the goal was reached, say so.
- "retire_note_ids": ids of notes that are now wrong, superseded, or say the same thing as another note. Leave a note alone if you are unsure. When two notes overlap, retire both and add one merged note.
- "add_notes": at most 4 short notes worth keeping for THIS chat that the notes do not already cover: what was tried and how it went, a decision made, an open question, a recurring kind of mistake. Under 30 words each.
- "new_facts": at most 3 durable facts about the USER or their computer that would still be true and useful in a different chat next month, and that the known facts do not already cover. Each has "kind" (setup, preference, history, or obstacle) and "content" under 20 words. Nothing about where this task stands. Nothing sensitive: no passwords, card numbers, security answers, or personal details the user did not offer as relevant.
- "changed": one plain sentence for the user saying what you tidied ("Merged two notes about the VPN and gave the chat a clearer name."). If you changed nothing but the title and summary, say that.

Empty lists are the normal answer for retire_note_ids, add_notes and new_facts. Do not invent anything that is not in the chat.`;

/** JSON Schema for the structured answer. */
export const TIDY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    where_we_left_off: { type: "string" },
    retire_note_ids: { type: "array", items: { type: "string" } },
    add_notes: { type: "array", items: { type: "string" } },
    new_facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["setup", "preference", "history", "obstacle"] },
          content: { type: "string" },
        },
        required: ["kind", "content"],
        additionalProperties: false,
      },
    },
    changed: { type: "string" },
  },
  required: [
    "title",
    "where_we_left_off",
    "retire_note_ids",
    "add_notes",
    "new_facts",
    "changed",
  ],
  additionalProperties: false,
} as const;

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** The one user message of the tidy call. */
export function tidyPrompt(
  record: ChatRecord,
  facts: readonly MemoryFact[],
): string {
  const parts: string[] = [`Goal, in the user's words: ${record.goal}`];
  parts.push(`Current title: ${record.title}`);
  if (record.state === "done") parts.push("The chat is marked finished.");

  if (record.stages.length > 0) {
    const i = Math.min(Math.max(record.stageIndex, 0), record.stages.length - 1);
    parts.push(
      `Plan stages (on stage ${i + 1} of ${record.stages.length}):\n` +
        record.stages.map((s, n) => `  ${n + 1}. ${s}`).join("\n"),
    );
  }

  parts.push(
    record.stepLog.length > 0
      ? `Steps logged as done:\n${record.stepLog.map((e, n) => `  ${n + 1}. ${e.text}`).join("\n")}`
      : "Steps logged as done: none.",
  );
  if (record.currentStep.trim()) {
    parts.push(`Step in progress when the user left: ${clip(record.currentStep, 300)}`);
  }

  const notes = liveNotes(record.notes);
  parts.push(
    notes.length > 0
      ? `The coach's notes for this chat:\n${notes
          .map(
            (n) =>
              `  [${n.id}]${n.edited ? " (edited by the user — do not retire)" : ""} ${n.text}`,
          )
          .join("\n")}`
      : "The coach's notes for this chat: none.",
  );

  const known = facts.filter((f) => !f.archived);
  parts.push(
    known.length > 0
      ? `Already known about this user:\n${known
          .slice(0, 60)
          .map((f) => `  - (${f.kind}) ${f.content}`)
          .join("\n")}`
      : "Already known about this user: nothing yet.",
  );

  const turns = record.turns.slice(-MAX_TURNS_READ);
  parts.push(
    `Conversation (most recent ${turns.length} of ${record.turns.length} messages):\n` +
      turns
        .map((t) => `${t.role === "user" ? "User" : "Coach"}: ${clip(t.content, MAX_TURN_CHARS)}`)
        .join("\n"),
  );

  return parts.join("\n\n");
}

// ── What comes back ──

export interface TidyProposal {
  title: string;
  whereWeLeftOff: string;
  retireNoteIds: string[];
  addNotes: string[];
  newFacts: { kind: MemoryKind; content: string }[];
  changed: string;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/** Read the model's answer. Null when it is not the shape that was asked for. */
export function parseTidyProposal(raw: unknown): TidyProposal | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.title !== "string" || typeof o.where_we_left_off !== "string") return null;
  const newFacts = (Array.isArray(o.new_facts) ? o.new_facts : [])
    .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
    .filter(
      (f): f is { kind: MemoryKind; content: string } =>
        typeof f.content === "string" &&
        typeof f.kind === "string" &&
        FACT_KINDS.includes(f.kind as MemoryKind),
    )
    .map((f) => ({ kind: f.kind, content: f.content }));
  return {
    title: o.title,
    whereWeLeftOff: o.where_we_left_off,
    retireNoteIds: strings(o.retire_note_ids),
    addNotes: strings(o.add_notes),
    newFacts,
    changed: typeof o.changed === "string" ? o.changed : "",
  };
}

export interface TidyOutcome {
  record: ChatRecord;
  /** Facts that passed every check and are not already known. */
  newFacts: { kind: MemoryKind; content: string }[];
  retired: number;
  added: number;
}

/**
 * Apply a proposal to a chat, keeping only what passes the fixed checks.
 *
 * Returns null — change nothing — when the proposal has no usable title or
 * summary: a tidy that cannot say where the chat stands is not worth applying
 * in part.
 */
export function applyTidy(
  record: ChatRecord,
  proposal: TidyProposal,
  knownFacts: readonly MemoryFact[],
  now: number,
  // Mints a note id. Injected so this stays pure.
  noteId: (n: number) => string,
): TidyOutcome | null {
  const title = clip(proposal.title.replace(/^["'“”]+|["'“”]+$/g, ""), MAX_TITLE_CHARS);
  const whereWeLeftOff = clip(proposal.whereWeLeftOff, MAX_SUMMARY_CHARS);
  if (!title || !whereWeLeftOff) return null;
  if (looksSensitive(title) || looksSensitive(whereWeLeftOff)) return null;

  // Retire: only notes that exist, are live, and the user has not edited —
  // and never more than half of what is there, so one bad answer cannot empty
  // a chat's memory.
  const live = liveNotes(record.notes);
  const retirable = new Set(live.filter((n) => !n.edited).map((n) => n.id));
  const toRetire = [...new Set(proposal.retireNoteIds)]
    .filter((id) => retirable.has(id))
    .slice(0, Math.floor(live.length / 2));
  let notes = record.notes;
  for (const id of toRetire) notes = forgetNote(notes, id, now);

  // Add: short, not sensitive, and not something already noted (addNote
  // refuses a note that matches a live OR a retired one, so a note the user
  // forgot cannot come back this way).
  let added = 0;
  for (const text of proposal.addNotes.slice(0, MAX_ADDED_NOTES)) {
    const clean = clip(text, MAX_NOTE_CHARS);
    if (!clean || looksSensitive(clean)) continue;
    const next = addNote(notes, clean, false, now, noteId(added));
    if (next !== notes && next.length > notes.length) {
      notes = next;
      added++;
    }
  }

  // Facts: short, not sensitive, not already known (archived counts as known,
  // so a forgotten fact stays forgotten), and not duplicating each other.
  const newFacts: { kind: MemoryKind; content: string }[] = [];
  const seen: MemoryFact[] = [...knownFacts];
  for (const fact of proposal.newFacts.slice(0, MAX_NEW_FACTS)) {
    const content = clip(fact.content, MAX_FACT_CHARS);
    if (!content || looksSensitive(content)) continue;
    if (isDuplicateFact(content, seen)) continue;
    newFacts.push({ kind: fact.kind, content });
    seen.push({
      id: `pending_${newFacts.length}`,
      userId: null,
      kind: fact.kind,
      content,
      sourceSessionId: record.id,
      createdAt: now,
      lastUsedAt: now,
      useCount: 0,
      archived: false,
    });
  }

  const tidy: ChatTidy = {
    turns: record.turns.length,
    at: now,
    whereWeLeftOff,
    changed: clip(proposal.changed, MAX_CHANGED_CHARS),
  };

  return {
    record: { ...record, title, whereWeLeftOff, notes, tidy },
    newFacts,
    retired: toRetire.length,
    added,
  };
}
