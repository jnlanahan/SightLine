import { describe, expect, it } from "vitest";
import {
  MAX_CHATS_SEARCHED,
  MAX_SEARCH_RESULTS,
  MAX_SNIPPET_CHARS,
  chatsToSearch,
  formatSearchResults,
  searchMemory,
  snippetAround,
  type MemorySearchHit,
} from "../../electron/memory-search";
import type {
  ChatRecord,
  ChatSummary,
  MemoryFact,
  MemoryKind,
} from "../../electron/db/schema";
import { EMPTY_USAGE } from "../../electron/usage";

// Searching the past (plan step 8). The coach only reaches for this when the
// user refers to something from before, so what matters is that the right
// chat comes back first, with a short snippet, and that nothing the user
// forgot — or the chat already open — ever comes back at all.

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function fact(
  id: string,
  content: string,
  overrides: Partial<MemoryFact> = {},
  kind: MemoryKind = "obstacle",
): MemoryFact {
  return {
    id,
    userId: null,
    kind,
    content,
    sourceSessionId: null,
    createdAt: NOW - 10 * DAY,
    lastUsedAt: NOW - 10 * DAY,
    useCount: 0,
    archived: false,
    ...overrides,
  };
}

function chat(id: string, overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id,
    userId: null,
    title: "Untitled",
    goal: "",
    state: "active",
    createdAt: NOW - 30 * DAY,
    lastActiveAt: NOW - 5 * DAY,
    stance: "guide",
    stepLog: [],
    currentStep: "",
    currentCode: "",
    expectedResult: null,
    upcomingSteps: [],
    whereWeLeftOff: "",
    notes: [],
    turns: [],
    uploadedContext: "",
    attachedFileNames: [],
    usage: { ...EMPTY_USAGE },
    costUsd: 0,
    claudeCalls: 0,
    ...overrides,
  };
}

function note(text: string, retiredAt: number | null = null) {
  return { id: `n_${text.length}`, text, seen: true, at: NOW - 20 * DAY, retiredAt };
}

function search(
  query: string,
  chats: ChatRecord[],
  facts: MemoryFact[] = [],
  extra: { currentChatId?: string | null; alreadyLoaded?: string } = {},
): MemorySearchHit[] {
  return searchMemory({
    query,
    facts,
    chats,
    currentChatId: extra.currentChatId ?? null,
    now: NOW,
    alreadyLoaded: extra.alreadyLoaded,
  });
}

const ids = (hits: MemorySearchHit[]) =>
  hits.map((h) => (h.source === "chat" ? h.chatId : h.factId));

describe("ranking", () => {
  it("prefers a match in a title or goal over one deep in a transcript", () => {
    const chats = [
      chat("chat_deep", {
        title: "Tidy the desktop",
        turns: [
          { role: "user", content: "Unrelated, but my OneDrive sync failed again.", at: NOW - 5 * DAY },
        ],
      }),
      chat("chat_title", { title: "Fix OneDrive sync", goal: "Get my files syncing" }),
    ];
    expect(ids(search("onedrive sync", chats))).toEqual(["chat_title", "chat_deep"]);
  });

  it("prefers a note over the transcript", () => {
    const chats = [
      chat("chat_transcript", {
        turns: [{ role: "assistant", content: "Try turning off the VPN for uploads.", at: NOW }],
      }),
      chat("chat_note", { notes: [note("VPN blocks uploads; turning it off fixes it")] }),
    ];
    expect(ids(search("vpn uploads", chats))[0]).toBe("chat_note");
  });

  it("matches more of the query ahead of less", () => {
    const chats = [
      chat("chat_one", { goal: "Printer setup" }),
      chat("chat_both", { goal: "Printer driver error on the office printer" }),
    ];
    expect(ids(search("printer driver", chats))).toEqual(["chat_both", "chat_one"]);
  });

  it("prefers the more recent chat when the match is the same", () => {
    const chats = [
      chat("chat_old", { title: "Excel pivot tables", lastActiveAt: NOW - 200 * DAY }),
      chat("chat_new", { title: "Excel pivot tables", lastActiveAt: NOW - 2 * DAY }),
    ];
    expect(ids(search("pivot tables", chats))).toEqual(["chat_new", "chat_old"]);
  });

  it("does not let recency lift a weak match over a strong one", () => {
    const chats = [
      chat("chat_recent_weak", {
        lastActiveAt: NOW,
        turns: [{ role: "user", content: "the printer is fine", at: NOW }],
      }),
      chat("chat_old_strong", { title: "Printer jams", lastActiveAt: NOW - 300 * DAY }),
    ];
    expect(ids(search("printer", chats))[0]).toBe("chat_old_strong");
  });

  it("finds a word in another form (uploads, uploading, uploaded)", () => {
    const chats = [chat("chat_a", { goal: "Uploading photos keeps failing" })];
    expect(ids(search("upload failure", chats))).toEqual(["chat_a"]);
  });

  it("searches facts alongside chats", () => {
    const hits = search(
      "vpn sync",
      [chat("chat_x", { title: "Sync calendar" })],
      [fact("fact_vpn", "Their VPN blocks the sync port; turning it off fixes uploads")],
    );
    expect(ids(hits)).toEqual(["fact_vpn", "chat_x"]);
    expect(hits[0]).toMatchObject({ source: "fact", factKind: "obstacle" });
  });

  it("returns one result per chat, from its best field", () => {
    const hits = search("outlook", [
      chat("chat_a", {
        title: "Outlook rules",
        notes: [note("Outlook is the classic desktop app")],
        turns: [{ role: "user", content: "outlook outlook", at: NOW }],
      }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "chat", field: "title" });
  });

  it("says where each chat result came from: title and last active", () => {
    const [hit] = search("teams", [
      chat("chat_t", { title: "Teams audio", lastActiveAt: NOW - 3 * DAY }),
    ]);
    expect(hit).toMatchObject({
      source: "chat",
      chatId: "chat_t",
      title: "Teams audio",
      lastActiveAt: NOW - 3 * DAY,
    });
  });

  it("searches the where-we-left-off line and the step log", () => {
    const hits = search("bitlocker recovery", [
      chat("chat_left", { whereWeLeftOff: "Waiting on the BitLocker recovery key from IT." }),
      chat("chat_log", { stepLog: [{ text: "Found the BitLocker recovery screen", at: NOW }] }),
    ]);
    expect(hits.map((h) => h.source === "chat" && h.field)).toEqual([
      "whereWeLeftOff",
      "stepLog",
    ]);
  });
});

describe("limits", () => {
  it("returns at most five results", () => {
    const chats = Array.from({ length: 12 }, (_, i) =>
      chat(`chat_${i}`, { title: `Wifi problem ${i}` }),
    );
    expect(search("wifi", chats)).toHaveLength(MAX_SEARCH_RESULTS);
    expect(MAX_SEARCH_RESULTS).toBe(5);
  });

  it("will not return more than five even if asked", () => {
    const chats = Array.from({ length: 8 }, (_, i) => chat(`chat_${i}`, { title: "wifi" }));
    expect(
      searchMemory({ query: "wifi", facts: [], chats, currentChatId: null, now: NOW, limit: 50 }),
    ).toHaveLength(5);
  });

  it("keeps every snippet to 300 characters, around the match", () => {
    const long =
      "filler words here ".repeat(60) +
      "the Zoom installer said error 1603 at the end " +
      "more filler afterwards ".repeat(60);
    const [hit] = search("1603 installer", [
      chat("chat_long", { turns: [{ role: "assistant", content: long, at: NOW }] }),
    ]);
    expect(hit.snippet.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS);
    expect(hit.snippet).toContain("installer said error 1603");
    expect(hit.snippet.startsWith("…")).toBe(true);
    expect(hit.snippet.endsWith("…")).toBe(true);
  });

  it("leaves short text whole", () => {
    expect(snippetAround("  Short   note  ", ["short"])).toBe("Short note");
  });

  it("reads only the 100 most recently active chats from the index", () => {
    const index: ChatSummary[] = Array.from({ length: 150 }, (_, i) => ({
      id: `chat_${i}`,
      userId: null,
      title: "",
      goal: "",
      state: "active",
      createdAt: 0,
      lastActiveAt: i, // chat_149 is the most recent
      whereWeLeftOff: "",
      stepsDone: 0,
    }));
    const picked = chatsToSearch(index, "chat_149");
    expect(picked).toHaveLength(MAX_CHATS_SEARCHED);
    expect(picked[0]).toBe("chat_148");
    expect(picked).not.toContain("chat_149");
    expect(picked).not.toContain("chat_0");
  });
});

describe("what is never returned", () => {
  it("never returns the chat the coach is in now", () => {
    const chats = [
      chat("chat_now", { title: "Printer offline" }),
      chat("chat_before", { title: "Printer offline last week" }),
    ];
    expect(ids(search("printer offline", chats, [], { currentChatId: "chat_now" }))).toEqual([
      "chat_before",
    ]);
  });

  it("skips retired notes", () => {
    const chats = [chat("chat_a", { notes: [note("Their password manager is Bitwarden", NOW - DAY)] })];
    expect(search("bitwarden", chats)).toEqual([]);
  });

  it("skips archived facts", () => {
    const facts = [fact("fact_gone", "Uses Bitwarden", { archived: true })];
    expect(search("bitwarden", [], facts)).toEqual([]);
  });

  it("skips facts already loaded into this chat", () => {
    const facts = [fact("fact_loaded", "Uses the Outlook desktop app")];
    const loaded = "What you already know…\n- (setup) Uses the Outlook desktop app";
    expect(search("outlook", [], facts, { alreadyLoaded: loaded })).toEqual([]);
  });

  it("returns nothing for an empty query, or one of only filler words", () => {
    const chats = [chat("chat_a", { title: "How do I do this" })];
    expect(search("", chats)).toEqual([]);
    expect(search("   ", chats)).toEqual([]);
    expect(search("how do i", chats)).toEqual([]);
  });

  it("returns nothing from an empty store", () => {
    expect(search("anything at all", [], [])).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(search("kubernetes", [chat("chat_a", { title: "Excel" })])).toEqual([]);
  });
});

describe("what the coach reads", () => {
  it("names the chat, when it was last active, and the snippet", () => {
    const hits = search("vpn", [
      chat("chat_v", {
        title: "Fix VPN uploads",
        lastActiveAt: NOW - 3 * DAY,
        notes: [note("VPN blocks the sync port")],
      }),
    ]);
    const text = formatSearchResults("vpn", hits, NOW);
    expect(text).toContain('Chat "Fix VPN uploads"');
    expect(text).toContain("3 days ago");
    expect(text).toContain("don't read these back as a list");
  });

  it("says plainly when nothing was found", () => {
    expect(formatSearchResults("kubernetes", [], NOW)).toContain("Nothing in earlier chats");
  });
});
