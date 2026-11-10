// The pure half of memory:update — the user correcting or confirming what the
// coach remembers about them.

import { describe, expect, it } from "vitest";
import { applyFactUpdate } from "../../electron/memory-edit";
import { MAX_MEMORY_CHARS } from "../../electron/instruction-parse";
import type { MemoryFact } from "../../electron/db/schema";

function fact(id: string, overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id,
    userId: null,
    kind: "setup",
    content: "uses Excel 2016",
    sourceSessionId: null,
    createdAt: 1,
    lastUsedAt: 1,
    useCount: 3,
    archived: false,
    ...overrides,
  };
}

describe("memory:update", () => {
  const facts = [fact("a"), fact("b", { content: "prefers shortcuts", kind: "preference" })];

  it("changes a fact's wording and nothing else", () => {
    const r = applyFactUpdate(facts, { id: "a", content: "  uses   Excel 365 " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fact).toEqual({ ...facts[0], content: "uses Excel 365", verified: false });
    expect(r.facts[1]).toBe(facts[1]);
  });

  it("marks a fact confirmed", () => {
    const r = applyFactUpdate(facts, { id: "b", verified: true });
    expect(r.ok && r.fact.verified).toBe(true);
    expect(r.ok && r.fact.content).toBe("prefers shortcuts");
  });

  it("keeps a confirmed fact confirmed when its wording changes", () => {
    const confirmed = [fact("a", { verified: true })];
    const r = applyFactUpdate(confirmed, { id: "a", content: "uses Excel 365" });
    expect(r.ok && r.fact.verified).toBe(true);
  });

  it("refuses to edit a forgotten fact, which would bring it back", () => {
    const r = applyFactUpdate([fact("a", { archived: true })], { id: "a", content: "x y z" });
    expect(r).toEqual({ ok: false, reason: "forgotten" });
  });

  it("refuses an unknown id, empty text, overlong text, and a change that changes nothing", () => {
    expect(applyFactUpdate(facts, { id: "zzz", verified: true })).toEqual({ ok: false, reason: "not_found" });
    expect(applyFactUpdate(facts, { id: "a", content: "   " })).toEqual({ ok: false, reason: "empty" });
    expect(applyFactUpdate(facts, { id: "a", content: "x".repeat(MAX_MEMORY_CHARS + 1) })).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(applyFactUpdate(facts, { id: "a", content: "uses Excel 2016" })).toEqual({
      ok: false,
      reason: "nothing",
    });
  });

  it("does not touch the list it was given", () => {
    const before = JSON.stringify(facts);
    applyFactUpdate(facts, { id: "a", content: "uses Excel 365", verified: true });
    expect(JSON.stringify(facts)).toBe(before);
  });
});
