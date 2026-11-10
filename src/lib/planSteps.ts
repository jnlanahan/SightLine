// Derive the visible plan from session state.
//
// The agent reports three things separately — the steps already done, the
// instruction it just gave, and the steps it expects to follow. The UI and
// the history record both need those stitched into one ordered list, so the
// stitching lives here, once, and is unit-tested.

export type PlanStepState = "completed" | "current" | "upcoming";

export interface PlanStep {
  description: string;
  state: PlanStepState;
  // When a completed step was done, from the chat's step log.
  at?: number;
}

export interface PlanInput {
  completedSteps: string[];
  // Parallel to completedSteps: when each was done. Optional — a list with no
  // log behind it simply shows no times.
  completedAt?: number[];
  // The instruction currently in flight. This is a spoken sentence rather
  // than a short phrase, so it gets shortened for list display.
  currentInstruction: string;
  upcomingSteps: string[];
  // When the session is finished there is no "current" step — everything the
  // coach said has already happened.
  done: boolean;
}

// A plan row is one line in a narrow sidebar. Instructions run to a couple of
// sentences, so they're trimmed to roughly one line's worth.
const MAX_STEP_CHARS = 72;

/** Shorten an instruction to a plan-row-sized phrase, on a word boundary. */
export function toStepPhrase(instruction: string): string {
  const text = instruction.trim().replace(/\s+/g, " ");
  if (text.length <= MAX_STEP_CHARS) return text;
  // Prefer cutting at the first sentence if that alone fits — the first
  // sentence of an instruction is almost always the action itself.
  const firstStop = text.search(/[.!?]\s/);
  if (firstStop > 0 && firstStop + 1 <= MAX_STEP_CHARS) {
    return text.slice(0, firstStop + 1);
  }
  const cut = text.slice(0, MAX_STEP_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The full ordered plan: what's done, what's happening, what's next. */
export function toPlanSteps(input: PlanInput): PlanStep[] {
  const steps: PlanStep[] = input.completedSteps
    .map((d, i) => ({
      description: d.trim(),
      state: "completed" as const,
      ...(input.completedAt?.[i] !== undefined ? { at: input.completedAt[i] } : {}),
    }))
    .filter((s) => s.description.length > 0);

  const current = input.currentInstruction.trim();
  if (current && !input.done) {
    steps.push({ description: toStepPhrase(current), state: "current" });
  }

  for (const raw of input.upcomingSteps) {
    const description = raw.trim();
    if (!description) continue;
    // The agent sometimes repeats a step it already marked complete; showing
    // it twice makes the progress count wrong and reads as a bug.
    if (steps.some((s) => s.description.toLowerCase() === description.toLowerCase())) {
      continue;
    }
    steps.push({ description, state: "upcoming" });
  }

  return steps;
}

/** Fraction complete, 0-1. Zero when there is no plan yet. */
export function planProgress(steps: readonly PlanStep[]): number {
  if (steps.length === 0) return 0;
  return steps.filter((s) => s.state === "completed").length / steps.length;
}
