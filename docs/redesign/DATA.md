# Data: from chat state to phases and steps

The coach already produces everything this design shows. This page says how existing fields become the screen, and the one small addition needed to put each message under the right step.

All of this belongs in one pure, unit-tested module, `src/lib/phaseView.ts`, in the same spirit as `src/lib/planSteps.ts` (which it builds on). Components only render its output.

## 1. What the coach already gives us

From `SessionState` (`src/store/session.ts`), mirrored in `ChatRecord` (`electron/db/schema.ts`):

| Field | Meaning | Used for |
| --- | --- | --- |
| `stages: string[]`, `stageIndex: number` | A long goal's stage titles and the current one (0-based). Empty for short goals | Phases |
| `stepLog: StepLogEntry[]` (`text`, `at`, `stage?`) | Every finished step, append-only, with the stage title it belonged to | Done steps and their phase |
| `currentInstruction`, `currentCode` | The instruction in flight (a spoken sentence) and its code | The lead line and its code block |
| `upcomingSteps: string[]` | The next **2 to 4** steps as short phrases. Not the full plan | Upcoming step dots, the step count, plan-change detection |
| `conversation: ConversationTurn[]` | The transcript | Messages, grouped by step |
| `stance: "guide" \| "watch"` | How the coach is helping | Which one-tap replies to show |
| `status`, `activeTool`, `done`, `pendingFollowUp`, `rateLimitUntil`, `lastError` | Live state | Coach state words, footer, needs-you banner |
| `resumePending` | Set when a chat was reopened | Resume divider |

`toPlanSteps()` in `src/lib/planSteps.ts` already stitches completed, current and upcoming into one ordered list. Reuse it; do not write a second stitcher.

## 2. Which layout

```ts
type Layout = "quick" | "single" | "phased";

function layoutOf(s): Layout {
  if (s.stages.length >= 2) return "phased";
  const known = s.stepLog.length + (s.currentInstruction && !s.done ? 1 : 0) + s.upcomingSteps.length;
  return known >= 2 ? "single" : "quick";
}
```

- `stages.length === 1` is treated as "single".
- **Sticky within a sitting:** once a chat has been "single" or "phased", it never drops back to "quick" during the same sitting, even if `upcomingSteps` empties near the end. Keep a `layoutFloor` in component state (not persisted). On reopen, recompute from the saved data.

## 3. Building the view

```ts
interface PhaseView {
  layout: Layout;
  phases: PhaseVM[];          // "single": one phase with an empty title; "quick": one phase, no rail
  currentPhase: number;       // index into phases; phases.length when done
  currentStep: number;        // global step number (1-based) of the step in progress
  stepInPhase: { k: number; K: number }; // header "step k of K"
}

interface PhaseVM {
  title: string;
  state: "done" | "current" | "upcoming";
  steps: StepVM[];            // empty for upcoming phases (steps not written yet)
}

interface StepVM {
  n: number;                  // global, 1-based
  title: string;              // see §3.2
  state: "done" | "current" | "upcoming";
  added: boolean;             // added this sitting (§4)
  turns: ConversationTurn[];  // see §5
  isLeadHolder: boolean;      // true only for the current step
}
```

### 3.1 Assigning done steps to phases
Walk `stepLog` in order, tracking the phase `p`, starting at 0. If `entry.stage` matches `stages[i]`, set `p = i`. If it is missing or does not match (a renamed stage), keep the current `p`. Then the entry belongs to phase `p`. This keeps older chats, and stages the coach renamed, in a sensible place.

### 3.2 Step titles
- Done steps: `entry.text` (the coach writes these as 3 to 7 word phrases).
- Current step: the phrase the coach had planned for it, which is `upcomingSteps[0]` from the turn **before** this step began. Track it in component state when a step completes: `nextTitle = previousUpcoming[0]`. Otherwise, fall back to no title: the label reads `Step {n}` alone. Do **not** use `toStepPhrase(currentInstruction)` for the label, because the lead line already says it in full.
- Upcoming steps: the `upcomingSteps` phrases. They appear only as rail dots, never in the chat.
- *Optional coach addition (later, not required):* a short `current_step` phrase on `say`/`wait` would remove the guesswork. It belongs to the plan skill (`electron/agents/skills/plan.ts`) and changes the cached tool schema, so it is a deliberate coach change, not part of this UI work.

### 3.3 Current phase and counts
- `currentPhase = clamp(stageIndex)` for "phased", and 0 otherwise. When `done`, it is `phases.length`, so every phase shows as done and the completion section renders.
- `K` = done steps in the current phase + 1 + `upcomingSteps.length`. Because the coach only shares 2 to 4 upcoming steps, K can grow as the user goes. That is expected; the header just reflects it.

## 4. Plan changes (session only)

After each coach turn, compare the plan before and after with a pure `diffPlan(prev, next, newlyCompleted)`:

- **Added step:** a phrase in `next.upcomingSteps` that was in neither `prev.upcomingSteps` nor `newlyCompleted`, **and** that sits at an index below `prev.upcomingSteps.length`. New phrases appended at the tail are the 2-to-4 window sliding forward. That is normal progress, not a change, so it gets no note.
- **Removed step:** a phrase in `prev.upcomingSteps` that is missing from `next.upcomingSteps` and was not completed this turn.
- **Rephrased:** additions and removals in the same turn → one note, "Plan updated: {n} steps changed".
- **Phases:** a title added to or removed from `stages` → "added phase" / "removed phase".
- A turn that leaves `upcomingSteps` out keeps the plan (that is the coach's rule today), so it is never a change.

Keep the resulting notes and the `added` flags in component state for the sitting. They are not persisted. On reopen, the plan simply shows as it is.

## 5. Putting each message under its step

**The one data addition.** Today a turn records only `role`, `content`, `code` and time, so nothing says which step it belongs to. Add two optional fields:

```ts
// electron/types.ts — ConversationTurn
stage?: number;   // stageIndex when the turn was added
step?: number;    // global step number in progress when the turn was added (stepLog.length + 1)

// electron/db/schema.ts — ChatTurnRecord: the same two fields
```

- Set them in one place: where turns are appended (`addTurn` in `src/store/session.ts`), from the store's own state at that moment.
- **Order matters for coach turns.** A coach turn that finishes a step usually also gives the next instruction, and that line belongs to the **new** step. Make sure the turn's step-log and stage updates are applied before the assistant turn is appended. Check the call order in `useSessionLoop.ts` / `App.tsx` and add a test that pins it.
- Carry both fields through `chat-record.ts` in both directions (live session ↔ saved chat), and accept them in `isChatRecordShape`. They are optional, so old chats still load. This touches the main-process shape check, so follow CLAUDE.md's rule that anything written to disk is checked there.
- No Postgres DDL change is needed if turns are stored as JSON. If `docs/PRODUCTION.md` has them as columns, add two nullable integer columns in `db/schema.ts` beside the types.

**Untagged turns (chats saved before this change):** assign by time. A turn belongs to the first logged step whose `at` is at or after the turn's time, and to that entry's phase (§3.1). A turn after the last logged step belongs to the current step.

**What becomes the lead line:** the current step's instruction, which is `currentInstruction`. It is shown once, large, inside the current step. It is the newest assistant turn whose text equals `currentInstruction`; hide its duplicate as `ConversationHistory` does today with `hideLatestAssistant`. Other coach turns in the current step render at body size.

## 6. Tests to add (`src/__tests__/phaseView.test.ts`)

- `layoutOf`: quick with no steps; single with steps and no stages; phased with two or more stages; one stage counts as single.
- Step-to-phase assignment: matched stage titles; a missing stage on old entries; a renamed stage.
- Step titles: the current step takes the previous turn's `upcomingSteps[0]`, and falls back to no title.
- `diffPlan`: a tail append is not a change; an insertion inside the window is "added"; removal; rephrase becomes one note; a stage added.
- Turn grouping: tagged turns; untagged turns grouped by time; a turn after the last log entry goes to the current step.
- Done: `currentPhase === phases.length`, with every phase done.
- `addTurn` ordering: a coach turn that completes a step is tagged with the new step number.
