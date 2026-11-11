import { describe, expect, it } from "vitest";
import {
  EMPTY_USAGE,
  addUsage,
  budgetStatus,
  cacheHitRate,
  estimateCostUsd,
  formatUsd,
  normalizeUsage,
  rateFor,
  type TokenUsage,
} from "../../electron/usage";

const usage = (u: Partial<TokenUsage>): TokenUsage => ({ ...EMPTY_USAGE, ...u });

describe("estimateCostUsd", () => {
  it("prices plain input and output at the model's list rate", () => {
    // Sonnet 4.6: $3/MTok in, $15/MTok out.
    const cost = estimateCostUsd(
      "claude-sonnet-4-6",
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    );
    expect(cost).toBeCloseTo(18, 6);
  });

  it("prices cache reads at a tenth of input", () => {
    const cost = estimateCostUsd(
      "claude-sonnet-4-6",
      usage({ cacheReadTokens: 1_000_000 }),
    );
    expect(cost).toBeCloseTo(0.3, 6);
  });

  it("prices cache writes at a premium over input", () => {
    const cost = estimateCostUsd(
      "claude-sonnet-4-6",
      usage({ cacheCreationTokens: 1_000_000 }),
    );
    expect(cost).toBeCloseTo(3.75, 6);
  });

  it("makes caching cheaper than not caching across repeated calls", () => {
    // The whole reason the system prompt is marked cacheable: one write plus
    // many reads must beat paying full input price every tick.
    const prefix = 2_000;
    const ticks = 20;
    const cached =
      estimateCostUsd("claude-sonnet-4-6", usage({ cacheCreationTokens: prefix })) +
      estimateCostUsd("claude-sonnet-4-6", usage({ cacheReadTokens: prefix })) *
        (ticks - 1);
    const uncached =
      estimateCostUsd("claude-sonnet-4-6", usage({ inputTokens: prefix })) * ticks;
    expect(cached).toBeLessThan(uncached);
  });

  it("is zero for an empty usage record", () => {
    expect(estimateCostUsd("claude-sonnet-4-6", EMPTY_USAGE)).toBe(0);
  });

  it("falls back to a conservative rate for an unknown model", () => {
    // Over-estimating is the safe direction: it trips the budget early rather
    // than letting an unpriced model spend silently.
    const unknown = estimateCostUsd("some-future-model", usage({ inputTokens: 1_000_000 }));
    const sonnet = estimateCostUsd("claude-sonnet-4-6", usage({ inputTokens: 1_000_000 }));
    expect(unknown).toBeGreaterThan(sonnet);
  });

  it("prices Haiku below Sonnet for identical usage", () => {
    const u = usage({ inputTokens: 500_000, outputTokens: 100_000 });
    expect(estimateCostUsd("claude-haiku-4-5", u)).toBeLessThan(
      estimateCostUsd("claude-sonnet-4-6", u),
    );
  });
});

describe("rateFor", () => {
  it("knows the model the session loop actually runs on", () => {
    expect(rateFor("claude-sonnet-4-6")).toEqual({ input: 3, output: 15 });
    // The background tidy-up's model.
    expect(rateFor("claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5 });
  });
});

describe("normalizeUsage", () => {
  it("maps the API's snake_case fields", () => {
    expect(
      normalizeUsage({
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40,
    });
  });

  it("defaults the cache fields when caching did not apply", () => {
    expect(normalizeUsage({ input_tokens: 5, output_tokens: 7 })).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("survives a missing or malformed usage object", () => {
    expect(normalizeUsage(null)).toEqual(EMPTY_USAGE);
    expect(normalizeUsage(undefined)).toEqual(EMPTY_USAGE);
    expect(normalizeUsage("nonsense")).toEqual(EMPTY_USAGE);
    expect(normalizeUsage({ input_tokens: -5, output_tokens: NaN })).toEqual(
      EMPTY_USAGE,
    );
  });
});

describe("addUsage", () => {
  it("sums every field", () => {
    const total = addUsage(
      usage({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 }),
      usage({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 }),
    );
    expect(total).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
    });
  });
});

describe("cacheHitRate", () => {
  it("is 0 before anything cacheable has happened", () => {
    expect(cacheHitRate(EMPTY_USAGE)).toBe(0);
  });

  it("reports the share of cacheable input served from cache", () => {
    expect(
      cacheHitRate(usage({ cacheReadTokens: 900, cacheCreationTokens: 100 })),
    ).toBeCloseTo(0.9, 6);
  });

  it("is 0 when every call had to write the cache fresh", () => {
    // The signature of a prefix that something invalidates every tick.
    expect(cacheHitRate(usage({ cacheCreationTokens: 5000 }))).toBe(0);
  });
});

describe("budgetStatus", () => {
  it("treats a zero or negative limit as no cap at all", () => {
    expect(budgetStatus(99, 0).level).toBe("ok");
    expect(budgetStatus(99, -1).level).toBe("ok");
    expect(budgetStatus(99, 0).fraction).toBe(0);
  });

  it("is ok well below the limit", () => {
    expect(budgetStatus(0.5, 3).level).toBe("ok");
  });

  it("warns before stopping, leaving room to finish the task", () => {
    expect(budgetStatus(2.4, 3).level).toBe("warn");
  });

  it("is exceeded at and above the limit", () => {
    expect(budgetStatus(3, 3).level).toBe("exceeded");
    expect(budgetStatus(4, 3).level).toBe("exceeded");
  });

  it("clamps the reported fraction at 1", () => {
    expect(budgetStatus(30, 3).fraction).toBe(1);
  });

  it("handles a non-finite limit as no cap", () => {
    expect(budgetStatus(5, Number.NaN).level).toBe("ok");
    expect(budgetStatus(5, Number.POSITIVE_INFINITY).level).toBe("ok");
  });
});

describe("formatUsd", () => {
  it("shows zero plainly", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("avoids showing a real cost as $0.00", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
  });

  it("formats normal amounts to cents", () => {
    expect(formatUsd(0.42)).toBe("$0.42");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

describe("realistic session cost", () => {
  // Token estimates below are derived from the actual payload the loop sends:
  // a full-resolution latest frame at up to 1280px wide (~1200 image tokens),
  // a reduced-resolution history frame at 640px (~300), the context header and
  // recent conversation (~400), a cached system prompt (~1800 cache-read), and
  // a short JSON reply (~180 output).
  const CHANGED_TICK = usage({
    inputTokens: 1_900,
    cacheReadTokens: 1_800,
    outputTokens: 180,
  });
  // Stall and check-in ticks send only the latest frame — the history frame
  // would be a duplicate of it.
  const UNCHANGED_TICK = usage({
    inputTokens: 1_600,
    cacheReadTokens: 1_800,
    outputTokens: 120,
  });

  it("keeps a typical hour well inside the budget", () => {
    // A realistic hour: the gate skips most ticks entirely, so Claude is
    // called roughly every 25-30s, and a good share of those are stall or
    // check-in looks at an unchanged screen.
    // Measured at ~$1.09. The assertion sits just above that so a regression
    // that inflates the payload (an extra frame, a leaked cache prefix) breaks
    // this test instead of quietly showing up on a bill.
    let total = EMPTY_USAGE;
    for (let i = 0; i < 90; i++) total = addUsage(total, CHANGED_TICK);
    for (let i = 0; i < 40; i++) total = addUsage(total, UNCHANGED_TICK);
    const cost = estimateCostUsd("claude-sonnet-4-6", total);
    expect(cost).toBeLessThan(1.25);
    expect(cost).toBeGreaterThan(0);
  });

  it("stays under the default cap even in a heavy hour", () => {
    // Worst case: a call every ~18 seconds for a solid hour, every one of
    // them on a changed screen. This is the number the 3.00 default budget
    // has to accommodate without tripping mid-task.
    let total = EMPTY_USAGE;
    for (let i = 0; i < 200; i++) total = addUsage(total, CHANGED_TICK);
    const cost = estimateCostUsd("claude-sonnet-4-6", total);
    expect(cost).toBeLessThan(2);
  });

  it("costs less per tick when the screen has not changed", () => {
    expect(estimateCostUsd("claude-sonnet-4-6", UNCHANGED_TICK)).toBeLessThan(
      estimateCostUsd("claude-sonnet-4-6", CHANGED_TICK),
    );
  });
});
