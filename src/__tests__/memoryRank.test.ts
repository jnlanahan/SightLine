import { describe, expect, it } from "vitest";
import {
  MAX_RECALLED_FACTS,
  VERIFIED_BOOST,
  findDuplicateFact,
  formatFactsForPrompt,
  isDuplicateFact,
  keywords,
  overlapScore,
  recencyScore,
  scoreFact,
  selectFacts,
  usefulnessScore,
} from "../../electron/memory-rank";
import type { MemoryFact, MemoryKind } from "../../electron/db/schema";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
function fact(
  content: string,
  kind: MemoryKind = "history",
  overrides: Partial<MemoryFact> = {},
): MemoryFact {
  seq++;
  return {
    id: `fact_${String(seq).padStart(4, "0")}`,
    userId: null,
    kind,
    content,
    sourceSessionId: null,
    createdAt: NOW - DAY,
    lastUsedAt: NOW - DAY,
    useCount: 0,
    archived: false,
    ...overrides,
  };
}

describe("keywords", () => {
  it("drops stop words and short tokens", () => {
    expect([...keywords("I want to set up the VPN on my laptop")]).toEqual([
      "vpn",
      "laptop",
    ]);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(keywords("Snowflake, warehouse!")).toEqual(
      keywords("snowflake warehouse"),
    );
  });

  it("returns nothing for text with no content words", () => {
    expect(keywords("to the of and").size).toBe(0);
  });
});

describe("overlapScore", () => {
  it("is high when a fact shares the goal's subject", () => {
    const goal = keywords("connect to the company VPN");
    expect(overlapScore(fact("their VPN blocks port 443"), goal)).toBeGreaterThan(0);
  });

  it("is zero for an unrelated fact", () => {
    const goal = keywords("connect to the company VPN");
    expect(overlapScore(fact("prefers dark mode in Photoshop"), goal)).toBe(0);
  });

  it("is zero when the goal has no content words", () => {
    expect(overlapScore(fact("uses the desktop app"), keywords("the and of"))).toBe(0);
  });
});

describe("recencyScore", () => {
  it("is highest for a fact just used", () => {
    expect(recencyScore(fact("x", "setup", { lastUsedAt: NOW }), NOW)).toBeCloseTo(1, 5);
  });

  it("decays as a fact goes untouched", () => {
    const fresh = recencyScore(fact("x", "setup", { lastUsedAt: NOW - DAY }), NOW);
    const stale = recencyScore(fact("x", "setup", { lastUsedAt: NOW - 90 * DAY }), NOW);
    expect(stale).toBeLessThan(fresh);
  });

  it("never decays to nothing — old facts can still be true", () => {
    const ancient = recencyScore(
      fact("x", "setup", { lastUsedAt: NOW - 3650 * DAY }),
      NOW,
    );
    expect(ancient).toBeGreaterThan(0.3);
  });
});

describe("usefulnessScore", () => {
  it("rewards facts that keep proving useful", () => {
    expect(usefulnessScore(fact("x", "setup", { useCount: 5 }))).toBeGreaterThan(
      usefulnessScore(fact("x", "setup", { useCount: 0 })),
    );
  });

  it("saturates so one early fact cannot dominate forever", () => {
    expect(usefulnessScore(fact("x", "setup", { useCount: 500 }))).toBe(
      usefulnessScore(fact("x", "setup", { useCount: 10 })),
    );
  });
});

describe("selectFacts", () => {
  it("returns nothing when there is nothing remembered", () => {
    expect(selectFacts([], "set up a VPN", NOW)).toEqual([]);
  });

  it("never returns archived facts", () => {
    const facts = [
      fact("they use the Windows desktop app", "setup", { archived: true }),
    ];
    expect(selectFacts(facts, "open the app", NOW)).toEqual([]);
  });

  it("surfaces setup facts even when the goal shares no words", () => {
    // "What machine are they on" helps on every task, not just matching ones.
    const facts = [fact("they use the Windows desktop app", "setup")];
    const picked = selectFacts(facts, "export a spreadsheet to PDF", NOW);
    expect(picked).toHaveLength(1);
  });

  it("ranks a topically matching fact above an unrelated one", () => {
    const related = fact("their VPN blocks the sync port", "obstacle");
    const unrelated = fact("last time they renamed a folder", "history");
    const picked = selectFacts([unrelated, related], "fix the VPN connection", NOW);
    expect(picked[0].id).toBe(related.id);
  });

  it("caps how much it recalls, so memory never floods the prompt", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      fact(`setup detail number ${i}`, "setup"),
    );
    expect(selectFacts(many, "do something", NOW).length).toBeLessThanOrEqual(
      MAX_RECALLED_FACTS,
    );
  });

  it("respects an explicit lower limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      fact(`setup detail ${i}`, "setup"),
    );
    expect(selectFacts(many, "anything", NOW, 2)).toHaveLength(2);
  });

  it("drops a purely topical fact that matches nothing", () => {
    const facts = [fact("last time they renamed a folder", "history")];
    expect(selectFacts(facts, "install a printer driver", NOW)).toEqual([]);
  });

  it("is deterministic — the same inputs give the same prompt every time", () => {
    // A prompt that reorders between ticks would churn the cached prefix.
    const facts = [
      fact("uses the desktop app", "setup", { lastUsedAt: NOW - DAY }),
      fact("prefers keyboard shortcuts", "preference", { lastUsedAt: NOW - DAY }),
      fact("works in the finance folder", "setup", { lastUsedAt: NOW - DAY }),
    ];
    const a = selectFacts(facts, "open a report", NOW).map((f) => f.id);
    const b = selectFacts([...facts].reverse(), "open a report", NOW).map((f) => f.id);
    expect(a).toEqual(b);
  });

  it("ignores a fact whose content is only whitespace", () => {
    expect(selectFacts([fact("   ", "setup")], "anything", NOW)).toEqual([]);
  });
});

describe("isDuplicateFact", () => {
  it("catches the same fact worded differently", () => {
    const existing = [fact("they use the Windows desktop app", "setup")];
    expect(isDuplicateFact("uses the desktop Windows app", existing)).toBe(true);
  });

  it("lets a genuinely new fact through", () => {
    const existing = [fact("they use the Windows desktop app", "setup")];
    expect(isDuplicateFact("their VPN blocks the sync port", existing)).toBe(false);
  });

  it("treats content-free text as already known, so it is never stored", () => {
    expect(isDuplicateFact("the and of", [])).toBe(true);
    expect(isDuplicateFact("", [])).toBe(true);
  });

  it("compares against every existing fact, not just the first", () => {
    const existing = [
      fact("prefers dark mode", "preference"),
      fact("their VPN blocks the sync port", "obstacle"),
    ];
    expect(isDuplicateFact("the VPN blocks their sync port", existing)).toBe(true);
  });
});

describe("formatFactsForPrompt", () => {
  it("is empty when nothing was recalled, so no tokens are spent", () => {
    expect(formatFactsForPrompt([])).toBe("");
  });

  it("labels each fact with its kind", () => {
    const text = formatFactsForPrompt([
      fact("uses the desktop app", "setup", { verified: true }),
    ]);
    expect(text).toContain("(setup) uses the desktop app");
  });

  it("tells the agent not to recite memory back at the user", () => {
    const text = formatFactsForPrompt([fact("uses the desktop app", "setup")]);
    expect(text.toLowerCase()).toContain("do not recite");
  });

  it("tells the agent the screen wins over stale memory", () => {
    const text = formatFactsForPrompt([fact("uses the desktop app", "setup")]);
    expect(text.toLowerCase()).toContain("screen says otherwise");
  });
});

describe("selectFacts — topical facts survive the floor", () => {
  it("keeps a months-old obstacle that matches the goal", () => {
    // Obstacles carry a low kind weight by design, so an old one used to fall
    // under the untopical cutoff even when it was exactly what the user was
    // about to hit again.
    const old = fact("their VPN blocks the sync port", "obstacle", {
      lastUsedAt: NOW - 90 * DAY,
    });
    const picked = selectFacts([old], "fix VPN upload failures", NOW);
    expect(picked.map((f) => f.id)).toEqual([old.id]);
  });

  it("still drops an untopical history note", () => {
    const note = fact("last time they renamed a folder", "history");
    expect(selectFacts([note], "configure the printer", NOW)).toEqual([]);
  });
});

describe("seen facts and unconfirmed ones", () => {
  it("marks a fact the coach never saw as unconfirmed, and says what that means", () => {
    const text = formatFactsForPrompt([
      fact("prefers keyboard shortcuts", "preference"),
      fact("uses the desktop app", "setup", { verified: true }),
    ]);
    expect(text).toContain("- (preference, unconfirmed) prefers keyboard shortcuts");
    expect(text).toContain("- (setup) uses the desktop app");
    expect(text).toContain("Facts marked unconfirmed were told to you or assumed");
  });

  it("treats a fact saved before the flag existed as unconfirmed", () => {
    const old = fact("uses the desktop app", "setup");
    expect(old).not.toHaveProperty("verified");
    expect(formatFactsForPrompt([old])).toContain("(setup, unconfirmed)");
  });

  it("spends no words on the explanation when every fact was seen", () => {
    const text = formatFactsForPrompt([
      fact("uses the desktop app", "setup", { verified: true }),
    ]);
    expect(text).not.toContain("unconfirmed");
  });

  it("gives a seen fact a modest boost", () => {
    expect(VERIFIED_BOOST).toBeGreaterThan(1);
    expect(VERIFIED_BOOST).toBeLessThanOrEqual(1.25);
    const goal = keywords("set up the VPN");
    const told = fact("uses the desktop app", "setup", { id: "a" });
    const seen = { ...told, verified: true };
    expect(scoreFact(seen, goal, NOW)).toBeCloseTo(scoreFact(told, goal, NOW) * VERIFIED_BOOST);
  });

  it("puts the seen fact first when two are otherwise equal", () => {
    const told = fact("uses the desktop app", "setup", { id: "fact_a" });
    const seen = fact("works on a Surface laptop", "setup", { id: "fact_b", verified: true });
    const picked = selectFacts([told, seen], "configure the printer", NOW);
    expect(picked.map((f) => f.id)).toEqual(["fact_b", "fact_a"]);
  });

  it("does not let the boost lift an irrelevant fact over a relevant one", () => {
    const relevant = fact("their VPN blocks the sync port", "obstacle");
    const irrelevant = fact("last time they renamed a folder", "history", { verified: true });
    const picked = selectFacts([irrelevant, relevant], "fix VPN sync failures", NOW);
    expect(picked[0].id).toBe(relevant.id);
  });

  it("does not lift a stale, untopical note past the floor", () => {
    const note = fact("last time they renamed a folder", "history", {
      verified: true,
      lastUsedAt: NOW - 120 * DAY,
    });
    expect(selectFacts([note], "configure the printer", NOW)).toEqual([]);
  });

  it("never drops a fact that was recalled before the flag existed", () => {
    // The boost only ever raises a score, so MIN_SCORE lets through at least
    // what it did before. Checked across kinds, ages and topics.
    const goals = ["set up the VPN", "configure the printer", "fix VPN sync failures"];
    const kinds: MemoryKind[] = ["setup", "preference", "obstacle", "history"];
    for (const goal of goals) {
      for (const kind of kinds) {
        for (const age of [0, 30, 90, 365]) {
          const told = fact("their VPN blocks the sync port", kind, {
            lastUsedAt: NOW - age * DAY,
          });
          const seen = { ...told, verified: true };
          if (selectFacts([told], goal, NOW).length === 1) {
            expect(selectFacts([seen], goal, NOW)).toHaveLength(1);
          }
        }
      }
    }
  });
});

describe("a forgotten fact", () => {
  it("is never recalled, however relevant, seen or used", () => {
    const forgotten = fact("their VPN blocks the sync port", "setup", {
      archived: true,
      verified: true,
      useCount: 10,
      lastUsedAt: NOW,
    });
    expect(selectFacts([forgotten], "fix the VPN sync port", NOW)).toEqual([]);
  });

  it("still counts as known, so it is not learned again", () => {
    const forgotten = fact("their VPN blocks the sync port", "obstacle", { archived: true });
    expect(isDuplicateFact("the VPN blocks their sync port", [forgotten])).toBe(true);
    expect(findDuplicateFact("the VPN blocks their sync port", [forgotten])?.id).toBe(
      forgotten.id,
    );
  });
});
