// A chat's notes are the chat's memory. The user can read, correct and forget
// them; the coach sees only live ones; and a forgotten note stays forgotten.

import { describe, expect, it } from "vitest";
import {
  MAX_LIVE_NOTES,
  MAX_NOTE_CHARS,
  addNote,
  editNote,
  forgetNote,
  liveNotes,
  normalizeNotes,
} from "../../electron/chat-notes";
import type { ChatNote } from "../../electron/db/schema";

function fill(count: number): ChatNote[] {
  let notes: ChatNote[] = [];
  for (let i = 0; i < count; i++) {
    notes = addNote(notes, `note number ${i}`, i % 2 === 0, 1_000 + i, `n${i}`);
  }
  return notes;
}

describe("adding a note", () => {
  it("records the text, the seen flag and the time", () => {
    const notes = addNote([], "  They use Excel 365  ", true, 5_000, "n1");
    expect(notes).toEqual([
      { id: "n1", text: "They use Excel 365", seen: true, at: 5_000, retiredAt: null },
    ]);
  });

  it("ignores an empty note", () => {
    const before: ChatNote[] = [];
    expect(addNote(before, "   ", true, 1, "x")).toBe(before);
  });

  it("does not add the same note twice, whatever the spacing or case", () => {
    const once = addNote([], "Uses the work account", false, 1, "a");
    expect(addNote(once, "uses  the WORK account", false, 2, "b")).toBe(once);
  });

  it("marks an existing note seen when the coach then reads it on screen", () => {
    const once = addNote([], "Uses the work account", false, 1, "a");
    const again = addNote(once, "Uses the work account", true, 2, "b");
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: "a", seen: true, at: 1 });
  });

  it("clips a runaway note", () => {
    const notes = addNote([], "x".repeat(MAX_NOTE_CHARS + 50), false, 1, "a");
    expect(notes[0].text).toHaveLength(MAX_NOTE_CHARS);
  });
});

describe("the cap of thirty live notes", () => {
  it("keeps up to the cap without retiring anything", () => {
    const notes = fill(MAX_LIVE_NOTES);
    expect(MAX_LIVE_NOTES).toBe(30);
    expect(liveNotes(notes)).toHaveLength(30);
    expect(notes.every((n) => n.retiredAt === null)).toBe(true);
  });

  it("retires the oldest when a new note would go over, and keeps it in the record", () => {
    const notes = addNote(fill(MAX_LIVE_NOTES), "the newest", false, 9_999, "new");
    expect(notes).toHaveLength(31);
    expect(liveNotes(notes)).toHaveLength(30);
    expect(notes[0]).toMatchObject({ id: "n0", retiredAt: 9_999 });
    expect(liveNotes(notes)[0].id).toBe("n1");
    expect(liveNotes(notes).at(-1)!.id).toBe("new");
  });

  it("does not count notes the user already forgot", () => {
    let notes = fill(MAX_LIVE_NOTES);
    notes = forgetNote(notes, "n5", 8_000);
    notes = addNote(notes, "fits in the gap", false, 9_000, "gap");
    expect(liveNotes(notes)).toHaveLength(30);
    // n0 is still live: only n5 was retired, by the user.
    expect(notes.find((n) => n.id === "n0")!.retiredAt).toBeNull();
    expect(notes.find((n) => n.id === "n5")!.retiredAt).toBe(8_000);
  });

  it("does not let a note the cap retired come straight back", () => {
    const notes = addNote(fill(MAX_LIVE_NOTES), "the newest", false, 9_999, "new");
    expect(addNote(notes, "note number 0", true, 10_000, "again")).toBe(notes);
  });
});

describe("the user correcting a note", () => {
  const base = addNote([], "They're on Windows 11", true, 1, "a");

  it("changes the text and keeps the id, time and mark", () => {
    const edited = editNote(base, "a", " They're on Windows 10 ");
    expect(edited[0]).toEqual({ id: "a", text: "They're on Windows 10", seen: true, at: 1, retiredAt: null });
  });

  it("ignores an empty edit, an unknown id, and a retired note", () => {
    expect(editNote(base, "a", "  ")).toBe(base);
    expect(editNote(base, "nope", "x")).toBe(base);
    const forgotten = forgetNote(base, "a", 5);
    expect(editNote(forgotten, "a", "back again")).toBe(forgotten);
  });
});

describe("the user forgetting a note", () => {
  it("retires it, hides it from live notes, and keeps it forgotten", () => {
    const base = addNote([], "They're on Windows 11", true, 1, "a");
    const forgotten = forgetNote(base, "a", 7);
    expect(forgotten[0].retiredAt).toBe(7);
    expect(liveNotes(forgotten)).toEqual([]);
    // Forgetting twice does not move the time.
    expect(forgetNote(forgotten, "a", 9)).toBe(forgotten);
    // The coach writing it again does not revive it.
    expect(liveNotes(addNote(forgotten, "They're on Windows 11", true, 8, "b"))).toEqual([]);
  });
});

describe("reading saved notes", () => {
  it("keeps notes already in the new shape exactly", () => {
    const notes: ChatNote[] = [
      { id: "a", text: "one", seen: true, at: 5, retiredAt: null },
      { id: "b", text: "two", seen: false, at: 6, retiredAt: 9 },
    ];
    expect(normalizeNotes(JSON.parse(JSON.stringify(notes)), 0)).toEqual(notes);
  });

  it("never reads a loose value as seen", () => {
    const read = normalizeNotes([{ id: "a", text: "one", seen: "true", at: 5 }], 0);
    expect(read[0].seen).toBe(false);
    expect(read[0].retiredAt).toBeNull();
  });

  it("gives clashing ids distinct values so one click changes one note", () => {
    const read = normalizeNotes(
      [
        { id: "a", text: "one", seen: false, at: 1, retiredAt: null },
        { id: "a", text: "two", seen: false, at: 2, retiredAt: null },
      ],
      0,
    );
    expect(new Set(read.map((n) => n.id)).size).toBe(2);
  });
});
