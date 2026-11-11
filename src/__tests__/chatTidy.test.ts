// The background tidy-up. A model proposes; these checks decide what is
// actually written to a chat and to memory. They are the reason an unattended
// call is allowed to touch saved data at all, so each one is pinned.

import { describe, expect, it } from "vitest";
import {
  TIDY_MIN_NEW_TURNS,
  TIDY_SCHEMA,
  applyTidy,
  looksSensitive,
  needsTidy,
  parseTidyProposal,
  tidyPrompt,
  type TidyProposal,
} from "../../electron/chat-tidy";
import { buildChatRecord, summarizeChat, chatToSession } from "../../electron/chat-record";
import { editNote, liveNotes } from "../../electron/chat-notes";
import type { ChatNote, ChatRecord, MemoryFact } from "../../electron/db/schema";
import { EMPTY_USAGE } from "../../electron/usage";

const note = (id: string, text: string, extra: Partial<ChatNote> = {}): ChatNote => ({
  id,
  text,
  seen: false,
  at: 1_000,
  retiredAt: null,
  ...extra,
});

function chat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id: "chat_1",
    userId: null,
    title: "set up a vpn on this laptop please",
    goal: "set up a vpn on this laptop please",
    state: "active",
    createdAt: 1_000,
    lastActiveAt: 9_000,
    stance: "guide",
    stepLog: [{ text: "Downloaded the client", at: 2_000 }],
    currentStep: "Open the app and sign in.",
    currentCode: "",
    expectedResult: null,
    upcomingSteps: [],
    stages: [],
    stageIndex: 0,
    whereWeLeftOff: "Done so far: Downloaded the client. Next: Open the app and sign in.",
    notes: [
      note("n1", "VPN client is version 4.2"),
      note("n2", "The client is v4.2"),
      note("n3", "Sign-in needs the work email"),
      note("n4", "Tried the store version first; it would not install"),
    ],
    turns: [
      { role: "user", content: "Goal: set up a vpn on this laptop please", at: 1_000 },
      { role: "assistant", content: "Download the client from the IT page.", at: 1_500 },
      { role: "user", content: "Done — what's next?", at: 2_000 },
      { role: "assistant", content: "Open the app and sign in.", at: 2_500 },
    ],
    uploadedContext: "",
    attachedFileNames: [],
    usage: { ...EMPTY_USAGE },
    costUsd: 0.05,
    claudeCalls: 2,
    ...overrides,
  };
}

const fact = (content: string, extra: Partial<MemoryFact> = {}): MemoryFact => ({
  id: `fact_${content.length}`,
  userId: null,
  kind: "setup",
  content,
  sourceSessionId: null,
  createdAt: 0,
  lastUsedAt: 0,
  useCount: 0,
  archived: false,
  ...extra,
});

function proposal(overrides: Partial<TidyProposal> = {}): TidyProposal {
  return {
    title: "VPN setup on the work laptop",
    whereWeLeftOff: "The client is installed. Next is signing in with the work email.",
    retireNoteIds: [],
    addNotes: [],
    newFacts: [],
    changed: "Gave the chat a clearer name.",
    ...overrides,
  };
}

const noteId = (n: number) => `note_new${n}`;

describe("when a chat is worth tidying", () => {
  it("waits for a few new turns since the last tidy", () => {
    expect(needsTidy(chat())).toBe(true);
    expect(needsTidy(chat({ turns: chat().turns.slice(0, TIDY_MIN_NEW_TURNS - 1) }))).toBe(false);
    expect(
      needsTidy(chat({ tidy: { turns: 4, at: 1, whereWeLeftOff: "x", changed: "" } })),
    ).toBe(false);
  });

  it("is flagged in the chat list", () => {
    expect(summarizeChat(chat()).needsTidy).toBe(true);
  });
});

describe("what the tidy-up is shown", () => {
  const prompt = tidyPrompt(chat(), [fact("Uses a Windows 11 laptop"), fact("Old", { archived: true })]);

  it("gives note ids, so a note can be named exactly", () => {
    expect(prompt).toContain("[n1] VPN client is version 4.2");
  });

  it("marks a note the user edited as off limits", () => {
    const edited = chat({ notes: editNote(chat().notes, "n3", "Sign-in needs my work email") });
    expect(tidyPrompt(edited, [])).toContain("[n3] (edited by the user — do not retire)");
  });

  it("lists what is already known, without forgotten facts", () => {
    expect(prompt).toContain("(setup) Uses a Windows 11 laptop");
    expect(prompt).not.toContain("Old");
  });

  it("asks for an answer shape with nothing optional and nothing extra", () => {
    expect(TIDY_SCHEMA.additionalProperties).toBe(false);
    expect([...TIDY_SCHEMA.required].sort()).toEqual(Object.keys(TIDY_SCHEMA.properties).sort());
  });
});

describe("reading the answer", () => {
  it("accepts the shape that was asked for", () => {
    const parsed = parseTidyProposal({
      title: "VPN setup",
      where_we_left_off: "Installed; sign in next.",
      retire_note_ids: ["n2", 7],
      add_notes: ["Store version would not install"],
      new_facts: [
        { kind: "setup", content: "Work laptop runs Windows 11" },
        { kind: "gossip", content: "nope" },
      ],
      changed: "Merged two notes.",
    });
    expect(parsed).toEqual({
      title: "VPN setup",
      whereWeLeftOff: "Installed; sign in next.",
      retireNoteIds: ["n2"],
      addNotes: ["Store version would not install"],
      newFacts: [{ kind: "setup", content: "Work laptop runs Windows 11" }],
      changed: "Merged two notes.",
    });
  });

  it("rejects anything else outright", () => {
    expect(parseTidyProposal(null)).toBeNull();
    expect(parseTidyProposal("VPN setup")).toBeNull();
    expect(parseTidyProposal({ title: "x" })).toBeNull();
  });
});

describe("applying a proposal", () => {
  it("writes the title, the summary and what changed", () => {
    const out = applyTidy(chat(), proposal(), [], 20_000, noteId)!;
    expect(out.record.title).toBe("VPN setup on the work laptop");
    expect(out.record.whereWeLeftOff).toContain("signing in with the work email");
    expect(out.record.tidy).toEqual({
      turns: 4,
      at: 20_000,
      whereWeLeftOff: "The client is installed. Next is signing in with the work email.",
      changed: "Gave the chat a clearer name.",
    });
  });

  it("changes nothing at all without a usable title and summary", () => {
    expect(applyTidy(chat(), proposal({ title: "  " }), [], 1, noteId)).toBeNull();
    expect(applyTidy(chat(), proposal({ whereWeLeftOff: "" }), [], 1, noteId)).toBeNull();
  });

  it("merges notes: retires the overlapping ones and adds the merged one", () => {
    const out = applyTidy(
      chat(),
      proposal({ retireNoteIds: ["n1", "n2"], addNotes: ["VPN client is version 4.2 (confirmed)"] }),
      [],
      20_000,
      noteId,
    )!;
    const live = liveNotes(out.record.notes).map((n) => n.text);
    expect(live).not.toContain("VPN client is version 4.2");
    expect(live).not.toContain("The client is v4.2");
    expect(live).toContain("VPN client is version 4.2 (confirmed)");
    expect(out.retired).toBe(2);
    expect(out.added).toBe(1);
    // Retired, not deleted — so they cannot be written straight back.
    expect(out.record.notes.find((n) => n.id === "n1")?.retiredAt).toBe(20_000);
  });

  it("never retires a note the user edited by hand", () => {
    const edited = chat({ notes: editNote(chat().notes, "n3", "Sign-in needs my work email") });
    const out = applyTidy(edited, proposal({ retireNoteIds: ["n3"] }), [], 20_000, noteId)!;
    expect(out.retired).toBe(0);
    expect(liveNotes(out.record.notes).map((n) => n.id)).toContain("n3");
  });

  it("still protects an edited note after the chat is saved and read back", () => {
    const edited = chat({ notes: editNote(chat().notes, "n3", "Sign-in needs my work email") });
    const reloaded = chatToSession(JSON.parse(JSON.stringify(edited)));
    expect(reloaded.agentNotes.find((n) => n.id === "n3")?.edited).toBe(true);
    const out = applyTidy(
      { ...edited, notes: reloaded.agentNotes },
      proposal({ retireNoteIds: ["n3"] }),
      [],
      20_000,
      noteId,
    )!;
    expect(out.retired).toBe(0);
  });

  it("ignores ids it was not given and notes already retired", () => {
    const withRetired = chat({
      notes: [...chat().notes, note("n9", "old", { retiredAt: 5 })],
    });
    const out = applyTidy(
      withRetired,
      proposal({ retireNoteIds: ["nope", "n9"] }),
      [],
      20_000,
      noteId,
    )!;
    expect(out.retired).toBe(0);
  });

  it("can never empty a chat's memory in one go", () => {
    const out = applyTidy(
      chat(),
      proposal({ retireNoteIds: ["n1", "n2", "n3", "n4"] }),
      [],
      20_000,
      noteId,
    )!;
    expect(out.retired).toBe(2);
    expect(liveNotes(out.record.notes)).toHaveLength(2);
  });

  it("does not bring back a note the user forgot", () => {
    const forgotten = chat({
      notes: [note("n1", "Prefers the dark theme", { retiredAt: 5 })],
    });
    const out = applyTidy(
      forgotten,
      proposal({ addNotes: ["Prefers the dark theme"] }),
      [],
      20_000,
      noteId,
    )!;
    expect(out.added).toBe(0);
    expect(liveNotes(out.record.notes)).toHaveLength(0);
  });

  it("caps how much it adds", () => {
    const out = applyTidy(
      chat({ notes: [] }),
      proposal({ addNotes: ["one thing", "another thing", "third item", "fourth item", "fifth item"] }),
      [],
      20_000,
      noteId,
    )!;
    expect(out.added).toBe(4);
  });

  it("learns a durable fact once, and not one already known or forgotten", () => {
    const known = [
      fact("Uses the Windows desktop app, not the web version"),
      fact("Their VPN blocks the sync port", { archived: true }),
    ];
    const out = applyTidy(
      chat(),
      proposal({
        newFacts: [
          { kind: "setup", content: "Uses the Windows desktop app, not the web version" },
          { kind: "obstacle", content: "Their VPN blocks the sync port" },
          { kind: "preference", content: "Prefers keyboard shortcuts over menus" },
          { kind: "preference", content: "Prefers keyboard shortcuts over menus" },
        ],
      }),
      known,
      20_000,
      noteId,
    )!;
    expect(out.newFacts).toEqual([
      { kind: "preference", content: "Prefers keyboard shortcuts over menus" },
    ]);
  });

  it("writes nothing that looks like a credential or a card number", () => {
    const out = applyTidy(
      chat({ notes: [] }),
      proposal({
        addNotes: ["The wifi password is hunter2", "Router admin page is at 192.168.1.1"],
        newFacts: [
          { kind: "setup", content: "Their card number is 4111111111111111" },
          { kind: "setup", content: "Their API key starts with sk" },
        ],
      }),
      [],
      20_000,
      noteId,
    )!;
    expect(liveNotes(out.record.notes).map((n) => n.text)).toEqual([
      "Router admin page is at 192.168.1.1",
    ]);
    expect(out.newFacts).toEqual([]);
    expect(applyTidy(chat(), proposal({ title: "Reset my password hunter2" }), [], 1, noteId)).toBeNull();
  });

  it("knows what sensitive looks like", () => {
    expect(looksSensitive("the passcode is 1234")).toBe(true);
    expect(looksSensitive("security answer: Rex")).toBe(true);
    expect(looksSensitive("Prefers keyboard shortcuts")).toBe(false);
    expect(looksSensitive("Excel 365 on Windows 11")).toBe(false);
  });

  it("leaves the transcript, the step log and the plan untouched", () => {
    const before = chat();
    const out = applyTidy(before, proposal({ retireNoteIds: ["n2"] }), [], 20_000, noteId)!;
    expect(out.record.turns).toEqual(before.turns);
    expect(out.record.stepLog).toEqual(before.stepLog);
    expect(out.record.currentStep).toBe(before.currentStep);
    expect(out.record.lastActiveAt).toBe(before.lastActiveAt);
  });
});

describe("the tidied summary and the live chat", () => {
  const tidied = applyTidy(chat(), proposal(), [], 20_000, noteId)!.record;

  it("survives reopening and saving while nothing new has been said", () => {
    const restored = chatToSession(tidied);
    expect(restored.tidy?.changed).toBe("Gave the chat a clearer name.");
    const resaved = buildChatRecord({
      id: tidied.id,
      title: tidied.title,
      goal: tidied.goal,
      createdAt: tidied.createdAt,
      now: 30_000,
      done: restored.done,
      stance: restored.stance,
      stepLog: restored.stepLog,
      currentStep: restored.currentInstruction,
      currentCode: restored.currentCode,
      expectedResult: restored.lastExpectedResult,
      upcomingSteps: restored.upcomingSteps,
      stages: restored.stages,
      stageIndex: restored.stageIndex,
      notes: restored.agentNotes,
      conversation: restored.conversation,
      uploadedContext: restored.uploadedContext,
      attachedFileNames: restored.attachedFileNames,
      usage: tidied.usage,
      costUsd: tidied.costUsd,
      claudeCalls: tidied.claudeCalls,
      tidy: restored.tidy,
    });
    expect(resaved.whereWeLeftOff).toBe(tidied.whereWeLeftOff);
    expect(resaved.tidy).toEqual(tidied.tidy);
    expect(summarizeChat(resaved).needsTidy).toBe(false);
  });

  it("gives way to the mechanical summary once the chat moves on", () => {
    const restored = chatToSession(tidied);
    const moved = buildChatRecord({
      id: tidied.id,
      title: tidied.title,
      goal: tidied.goal,
      createdAt: tidied.createdAt,
      now: 30_000,
      done: false,
      stance: "guide",
      stepLog: [...restored.stepLog, { text: "Signed in", at: 25_000 }],
      currentStep: "Pick a server.",
      currentCode: "",
      expectedResult: null,
      upcomingSteps: [],
      stages: [],
      stageIndex: 0,
      notes: restored.agentNotes,
      conversation: [
        ...restored.conversation,
        { role: "assistant", content: "Pick a server.", timestamp: 26_000 },
      ],
      uploadedContext: "",
      attachedFileNames: [],
      usage: tidied.usage,
      costUsd: tidied.costUsd,
      claudeCalls: tidied.claudeCalls,
      tidy: restored.tidy,
    });
    expect(moved.whereWeLeftOff).toContain("Signed in");
    expect(moved.whereWeLeftOff).toContain("Next: Pick a server.");
  });
});
