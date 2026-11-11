// Token accounting and cost estimation.
//
// The session loop looks at the screen every few seconds, so cost is a real
// product constraint rather than a footnote. This module turns raw API usage
// into dollars so the UI can show a live meter and the loop can stop before a
// runaway burns through a budget.
//
// Pure module — no Electron, no network — so it is unit-testable from the
// renderer test suite and usable from both processes.

/** Raw token counts as reported by the Anthropic API. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  // Tokens written to the prompt cache this call (billed at a premium).
  cacheCreationTokens: number;
  // Tokens served from the prompt cache this call (billed at ~1/10th).
  cacheReadTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

/** Per-million-token list prices, in USD. */
interface ModelRate {
  input: number;
  output: number;
}

// Checked against the Claude API model reference, October 2026. Sonnet 4.6 is
// what the session loop runs on: Opus-tier costs ~1.7x more per token for a
// task that is mostly "look at this screenshot and decide whether to speak",
// and its extra depth does not pay for itself against time-to-first-token —
// which the user feels on every single tick.
const RATES: Record<string, ModelRate> = {
  // The background tidy-up's model.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  // Candidates for the coach, not in use yet (docs/ONE-COACH-PLAN.md, step 10).
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
};

// Used when a model id isn't in the table — better to over-estimate cost and
// warn early than to silently under-report and blow the budget.
const FALLBACK_RATE: ModelRate = { input: 5, output: 25 };

// Cache economics: reads cost about a tenth of base input, writes about 1.25x
// (the 5-minute TTL premium, which is what `cache_control: ephemeral` buys).
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

const PER_MILLION = 1_000_000;

export function rateFor(model: string): ModelRate {
  return RATES[model] ?? FALLBACK_RATE;
}

/** Estimated USD cost of one API call. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const rate = rateFor(model);
  const inputCost =
    usage.inputTokens * rate.input +
    usage.cacheCreationTokens * rate.input * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * rate.input * CACHE_READ_MULTIPLIER;
  const outputCost = usage.outputTokens * rate.output;
  return (inputCost + outputCost) / PER_MILLION;
}

/** Sum two usage records. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

/**
 * Normalize the SDK's usage object, which uses snake_case and omits the cache
 * fields entirely when caching didn't apply.
 */
export function normalizeUsage(raw: unknown): TokenUsage {
  if (!raw || typeof raw !== "object") return { ...EMPTY_USAGE };
  const u = raw as Record<string, unknown>;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
  };
}

/**
 * How well prompt caching is working, as a fraction of cacheable input served
 * from cache. A session that has been running a while should sit high here;
 * a number stuck near zero means something is invalidating the cached prefix
 * every tick (the classic cause is per-tick data leaking into the system
 * prompt, which is why buildContextHeader puts it in the user message).
 */
export function cacheHitRate(usage: TokenUsage): number {
  const cacheable = usage.cacheReadTokens + usage.cacheCreationTokens;
  if (cacheable === 0) return 0;
  return usage.cacheReadTokens / cacheable;
}

export type BudgetLevel = "ok" | "warn" | "exceeded";

export interface BudgetStatus {
  level: BudgetLevel;
  spentUsd: number;
  limitUsd: number;
  /** 0-1; always 0 when no limit is set. */
  fraction: number;
}

// Warn at 80% so the user has room to finish the task before anything stops.
const WARN_FRACTION = 0.8;
// Dollar amounts accumulate through floating-point addition, so an exact
// boundary like 2.40 / 3.00 lands at 0.7999999999999999 and would skip the
// warning entirely. Compare with a tolerance well below one cent.
const FRACTION_EPSILON = 1e-9;

/**
 * Where this session stands against its budget. A limit of 0 (or less) means
 * "no cap" and always reports "ok" — the setting is a runaway guard, and a
 * user who turns it off should never be interrupted by it.
 */
export function budgetStatus(spentUsd: number, limitUsd: number): BudgetStatus {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
    return { level: "ok", spentUsd, limitUsd: 0, fraction: 0 };
  }
  const fraction = spentUsd / limitUsd;
  const level: BudgetLevel =
    fraction >= 1 - FRACTION_EPSILON
      ? "exceeded"
      : fraction >= WARN_FRACTION - FRACTION_EPSILON
        ? "warn"
        : "ok";
  return { level, spentUsd, limitUsd, fraction: Math.min(fraction, 1) };
}

/** Compact display string for the cost meter, e.g. "$0.42". */
export function formatUsd(amount: number): string {
  if (amount <= 0) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}
