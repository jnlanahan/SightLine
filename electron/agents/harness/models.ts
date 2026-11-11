// Which model the coach runs on, and how a look has to be asked of each.
//
// The models do not share a request surface, and the differences are exactly
// the things the coach's turn is built on:
//
//   - Sonnet 5.5 and Opus 5.5 REJECT forced tool choice. The older models let
//     the request insist the reply be one of say or wait; these do not, so the
//     request says "auto" and the runner checks that a tool was actually
//     called (and asks again, once, if it was not).
//   - Thinking cannot be switched off on them the old way. Sonnet 5.5 has its
//     own lowest setting; Opus 5.5 always thinks, and effort is the only dial.
//   - Their thinking is tied to the exact request it was produced in, so the
//     tool list must not change in the middle of a look.
//
// Everything model-specific lives here, as plain data, so the runner has one
// code path and a new model is a new entry rather than a new branch.
//
// Checked against the Claude API model reference and migration guide, and
// against live requests on the owner's account, 10 November 2026. Read the
// migration guide for a model before adding it.
//
// Pure module — no imports.

/** The user's choice in Settings. */
export type CoachModelChoice = "sonnet" | "opus";

export interface ModelProfile {
  /** `tool_choice: any` is accepted, so a reply is guaranteed to be a tool call. */
  forcedToolChoice: boolean;
  /** The request's `thinking` field. Null = leave it out. */
  thinking: Record<string, unknown> | null;
  /** `output_config.effort`. Null = leave it out. */
  effort: "low" | "medium" | "high" | null;
  /** Room for the reply — and, where the model always thinks, for that too. */
  maxTokens: number;
  /**
   * Ask the API to retry a safety decline on another model inside the same
   * call, instead of the look coming back empty. Needs the beta endpoint.
   */
  serverFallback: boolean;
}

/** The models the user can pick between. */
export const COACH_MODELS: Record<CoachModelChoice, string> = {
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

/**
 * What the coach falls back to, for the rest of the run, if the account
 * cannot use the chosen model. Also what the mid-look web search runs on.
 */
export const FALLBACK_COACH_MODEL = "claude-sonnet-5";

/** Sonnet 5 and earlier: forced tool choice, thinking simply off. */
const LEGACY: ModelProfile = {
  forcedToolChoice: true,
  thinking: { type: "disabled" },
  effort: null,
  maxTokens: 3072,
  serverFallback: false,
};

const PROFILES: Record<string, ModelProfile> = {
  // Thinking at its lowest setting, so the first spoken word is not waiting
  // behind deliberation. Medium effort is the guide's starting point for
  // work that uses tools; three live first looks at "low" on 10 November 2026
  // were no faster to the first word, so there was nothing to trade for it.
  "claude-sonnet-5-5": {
    forcedToolChoice: false,
    thinking: { type: "between_tools" },
    effort: "medium",
    maxTokens: 4096,
    serverFallback: true,
  },
  // Always thinks; low effort keeps that short. The allowance has to cover
  // the thinking as well as the reply.
  "claude-opus-5-5": {
    forcedToolChoice: false,
    thinking: null,
    effort: "low",
    maxTokens: 8000,
    serverFallback: true,
  },
};

export function profileFor(model: string): ModelProfile {
  return PROFILES[model] ?? LEGACY;
}

/** The model id for a Settings choice. Anything unrecognised means Sonnet. */
export function coachModelFor(choice: unknown): string {
  return choice === "opus" ? COACH_MODELS.opus : COACH_MODELS.sonnet;
}
