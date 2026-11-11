// A chat's notes: what the coach remembers about this one chat.
//
// The coach writes one short line at a time through its `notes` field. Each
// becomes a note with an id, a "seen on screen" flag, the time it was
// written, and a retired time. The user can read them in About this chat,
// correct one, or forget one.
//
// Notes are never deleted. Forgetting one, or pushing one out with the cap,
// retires it: it stays in the saved chat but is no longer shown to the coach
// or the user. Keeping it is what stops the coach writing a forgotten note
// straight back on its next look.
//
// Pure module — no Electron, no fs, no clock or randomness of its own
// (callers pass `now` and the new id) — so it is unit-testable and importable
// from both processes.

import type { ChatNote } from "./db/schema";

/** Live notes per chat at most. The oldest is retired to make room. */
export const MAX_LIVE_NOTES = 30;

// One short line is what the coach is asked for; a user's edit gets a bit
// more room, but a note is still not a document.
export const MAX_NOTE_CHARS = 300;

export function newNoteId(now: number): string {
  return `note_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Notes the coach and the user still see, oldest first. */
export function liveNotes(notes: readonly ChatNote[]): ChatNote[] {
  return notes.filter((n) => n.retiredAt === null);
}

// How many replaced wordings a note remembers.
const MAX_PREVIOUS_WORDINGS = 5;

function sameText(a: string, b: string): boolean {
  const norm = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Read notes from a saved chat, whatever shape they were saved in.
 *
 * Chats saved before notes had ids hold plain strings. Those become notes
 * marked not seen (nobody recorded whether they were), written at
 * `fallbackAt` — the chat's own creation time is the honest choice — with
 * ids derived from their position so the same old chat always converts the
 * same way. Anything unreadable is dropped rather than failing the chat.
 */
export function normalizeNotes(raw: unknown, fallbackAt: number): ChatNote[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatNote[] = [];
  const ids = new Set<string>();
  raw.forEach((item, i) => {
    let note: ChatNote | null = null;
    if (typeof item === "string") {
      const text = item.trim();
      if (text) {
        note = { id: `note_old${i}`, text, seen: false, at: fallbackAt, retiredAt: null };
      }
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (text) {
        note = {
          id: typeof o.id === "string" && o.id ? o.id : `note_old${i}`,
          text,
          seen: o.seen === true,
          at: typeof o.at === "number" && Number.isFinite(o.at) ? o.at : fallbackAt,
          retiredAt:
            typeof o.retiredAt === "number" && Number.isFinite(o.retiredAt)
              ? o.retiredAt
              : null,
          // Kept across a save and reload, or the tidy-up would lose track of
          // which notes are in the user's own words.
          ...(o.edited === true ? { edited: true } : {}),
          ...(Array.isArray(o.previous)
            ? { previous: o.previous.filter((p): p is string => typeof p === "string") }
            : {}),
        };
      }
    }
    if (!note) return;
    // Ids are how the screen edits and forgets a note; a clash would make one
    // click change two notes.
    if (ids.has(note.id)) note = { ...note, id: `${note.id}_${i}` };
    ids.add(note.id);
    out.push(note);
  });
  return out;
}

/**
 * Record a note the coach just wrote.
 *
 * A note whose text matches one already in the chat — live or retired — is
 * not added again. That is what keeps a forgotten note forgotten. If it
 * matches a live note and this time the coach saw it on screen, the live note
 * is marked seen.
 *
 * When the new note would take the chat past MAX_LIVE_NOTES, the oldest live
 * notes are retired (stamped with `now`) until it fits.
 *
 * Returns the same array when nothing changed.
 */
export function addNote(
  notes: readonly ChatNote[],
  text: string,
  seen: boolean,
  now: number,
  id: string,
): ChatNote[] {
  const clean = text.trim().slice(0, MAX_NOTE_CHARS);
  if (!clean) return notes as ChatNote[];
  const match = notes.find((n) => sameText(n.text, clean));
  // The wording the user corrected away is a repeat too, and it must not
  // come back beside their correction.
  if (!match && notes.some((n) => (n.previous ?? []).some((p) => sameText(p, clean)))) {
    return notes as ChatNote[];
  }
  if (match) {
    if (seen && !match.seen && match.retiredAt === null) {
      return notes.map((n) => (n.id === match.id ? { ...n, seen: true } : n));
    }
    return notes as ChatNote[];
  }
  const next: ChatNote[] = [
    ...notes,
    { id, text: clean, seen, at: now, retiredAt: null },
  ];
  let over = liveNotes(next).length - MAX_LIVE_NOTES;
  if (over <= 0) return next;
  return next.map((n) => {
    if (over > 0 && n.retiredAt === null) {
      over--;
      return { ...n, retiredAt: now };
    }
    return n;
  });
}

/**
 * The user corrected a note. Only a live note can be edited; an empty edit
 * changes nothing (forgetting is its own action). The "seen" mark is kept:
 * the user fixed the wording, which says nothing about where it came from.
 */
export function editNote(
  notes: readonly ChatNote[],
  id: string,
  text: string,
): ChatNote[] {
  const clean = text.trim().slice(0, MAX_NOTE_CHARS);
  if (!clean) return notes as ChatNote[];
  let changed = false;
  const next = notes.map((n) => {
    if (n.id !== id || n.retiredAt !== null || n.text === clean) return n;
    changed = true;
    // Marked so the background tidy-up leaves the user's wording alone, and
    // the replaced wording is kept so it cannot be noted again.
    return {
      ...n,
      text: clean,
      edited: true,
      previous: [...(n.previous ?? []), n.text].slice(-MAX_PREVIOUS_WORDINGS),
    };
  });
  return changed ? next : (notes as ChatNote[]);
}

/** The user forgot a note: retire it, keeping it so it is not re-learned. */
export function forgetNote(
  notes: readonly ChatNote[],
  id: string,
  now: number,
): ChatNote[] {
  let changed = false;
  const next = notes.map((n) => {
    if (n.id !== id || n.retiredAt !== null) return n;
    changed = true;
    return { ...n, retiredAt: now };
  });
  return changed ? next : (notes as ChatNote[]);
}
