# Overnight job 1: remove what the one coach replaced (plan step 5)

Follow every rule in `docs/overnight/2026-11-09/README.md`.

**Branch:** from `one-coach`, named `claude/overnight-2026-11-09-trim`. Pull request against `one-coach`.

## Goal

The app now runs one agent, `coach`, started from one goal box, with saved chats. The three older agents, the setup flow, the training-plan machinery and the old session history are still in the tree but cannot be reached. Remove them. Behaviour must not change: this job only deletes, and fixes what the deletions break.

The list is in `docs/ONE-COACH-PLAN.md`, step 5. Notes that go beyond it:

## Remove

**Agents and harness**
- `electron/agents/tech-support.ts`, `training.ts`, `teacher.ts`.
- Skills only they used: `skills/pacing.ts`, `verify.ts`, `observe.ts`, `review.ts`, `socratic.ts`; `tools/plan.ts`; the deferred research skill and its legacy fields in `skills/research.ts`; the unused per-mode memory lines in `skills/memory.ts`; the `withTools` path in `skills/plan.ts`; `shared.ts` if nothing uses it afterwards.
- The plan-edit plumbing (`PlanEdit`, `PlanDraft`, `applyPlanEdits`) and the `trainingContext` and `referenceFrame` fields.
- From the turn result and both parsers: `needsResearch`, `researchQuery`, `taskVerdict`, `mistakePattern`.
- `AppMode` and the `mode` value everywhere it is passed: the registry (one agent; `allAgents` goes), `agent:describe`, the next-instruction arguments, the turn context, the session store, the policy cache. `Agent.clarificationPrompt`, `planPrompt` and `maxClarifications` go too.

**Calls and channels**
- In `electron/claude.ts`: `getClarifications`, `getSessionPlan`, `getCurriculumOutline`, `detailTrainingModule`, `getGoalEvaluation`, `runWebResearch`. Keep `runQuickWebResearch`; the `search_web` tool uses it.
- Their channels, plus `research:search` with its DuckDuckGo fallback, `history:*`, `plans:*`, `window:open-external`, `dock:set`, in `electron/main.ts` and `electron/preload.ts`. Delete the stale `IpcChannel` type.

**Storage**
- Session, plan and plan-frame functions in `electron/db/store.ts`; `SessionRecord`, `SessionSummary` and the training-plan types in `electron/db/schema.ts`, with their tables in the Postgres text. `memory_facts.source_session_id` then has nothing to reference: make it a plain text column.
- `electron/training-plan.ts`. Check first whether anything you are keeping imports from it.

**Renderer**
- `src/components/GoalPrompt.tsx`, `ModeSelect.tsx`, `CurriculumOutline.tsx`; `src/lib/trainingProgress.ts`, `src/lib/sessionRecord.ts`; the curriculum helper in `src/lib/planSteps.ts`.
- In `src/App.tsx`: `startTrainingSession`, `finalizeTrainingPlan` and its ref, every `activePlan` branch, `MODE_META`, the "Done ✓" button with `markDone`, the verdict card and its state.
- In `src/hooks/useSessionLoop.ts`: the training-turn handling, the legacy research branch, and the two teacher-only branches (the "only when a follow-up is pending" gate and the "no auto-poll" chain exit). `LoopPolicy.requireScreenChange` is then always true: remove the field only if that stays a small change; otherwise leave it and say so.
- Statuses `clarifying`, `researching`, `evaluating`, with their labels and cards.
- Store fields `pauseReason`, `lastTtsEngine`, `researchQuery`, `clarificationContext`, `activePlan`, `mode`.
- The "Check frequency" control and `captureIntervalSec`. The "Keep session history" switch and `historyEnabled`.
- Unused pieces of `src/design/primitives.tsx` and `src/design/icons.tsx`. Confirm each with a search before deleting.
- The `@types/jsdom` dev dependency, if a search confirms nothing uses it. Removing a dependency is allowed here.

**Wording**
- `src/components/PrivacyNotice.tsx`: keys are stored encrypted on this PC (not in Windows Credential Manager). "Screenshots are never written to disk" becomes true once the plan frames are gone; keep it.
- A missing key: say plainly that `ANTHROPIC_API_KEY` goes in the `.env` file and the app needs a restart. Remove the "add one above" hints that point at nothing.
- Settings: "Dock to the side during sessions" loses "during sessions". The section titled "Window" that only holds the voice switch becomes "Voice".
- `.env.example` and `docs/PRODUCTION.md`: fix the statements about key storage and about screenshots.

## Leave alone

- The layout of the session screen: both mute buttons, both attach buttons, peek, pause, the cost pill. The screen is being redesigned separately.
- `src/hooks/useVoice.ts` and the dictation button on Home. Replacing it with hold-to-talk needs a live check.
- `electron/instruction-parse.ts`: the runner still falls back to it. Only drop the removed fields.
- `electron/usage.ts` prices. Step 10 handles them.
- `CLAUDE.md`. Step 12 rewrites it.
- Screen capture, calibration, docking, the glow overlay, the speech pipeline, push-to-talk, frame hashing, the loop gate, the budget, credentials, logging.

## Tests

- Delete tests for deleted code: `techSupportSkills.test.ts`, `trainingPlan.test.ts`, `sessionRecord.test.ts`, the curriculum case in `planSteps.test.ts`, the teacher case in `loopGate.test.ts`, the setup-overview case in `muteConsistency.test.ts`.
- `agentHarness.test.ts`, `agentPrompts.test.ts`, `claude.prompt.test.ts`, `agentRunner.test.ts`, `agentRunner.robustness.test.ts`, `sessionLoop.timing.test.ts`: move their fixtures to the coach. Keep every pin on behaviour that still exists (byte-stable prefix, speech fields first, a follow-up is never answered with silence, the finished-step bounce, history opens on a user turn, `max_tokens` keeps the previous lists, a response with no tool call ends silently). Where `coach.test.ts` already pins the same thing, delete the duplicate. Never weaken an assertion to make it pass: if a behaviour pin fails against the coach, that is a finding for your report, not something to edit away.

## Check

`npm test`, `npm run lint`, `npm run build`. Then search the tree for these and explain any that remain: `tech_support`, `teacher`, `training`, `activePlan`, `needsResearch`, `taskVerdict`, `getClarifications`, `history.`, `plans.`.

## Report

`docs/overnight/2026-11-09/JOB-1-REPORT.md`. Include `git diff --shortstat origin/one-coach...HEAD`, the files deleted, test counts before and after, every item on the list you did not remove and why, and anything you found that looked wrong but was out of scope.
