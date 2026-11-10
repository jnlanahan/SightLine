# Job 1 report: removing what the one coach replaced (plan step 5)

Pull request: https://github.com/jnlanahan/SightLine/pull/6, from `claude/overnight-2026-11-09-trim` into `one-coach`. It starts from `one-coach` itself, not from another job's branch.

## In plain words

The app had a lot of old machinery that nothing could reach any more: the three older coaches, the setup questions, the training plans, the old session history, and the screens that went with them. I deleted all of it. About **5,600 lines** are gone, including **19 whole files**. What's left is the one coach, the chat list and saved chats, which is what you'll be trying.

None of this was meant to change what you see or hear. You'll notice four small things:

- Settings no longer has the "Check frequency" buttons or the "Keep session history" switch. Neither did anything.
- If there's no Anthropic key, Settings now says in red that `ANTHROPIC_API_KEY` goes in the `.env` file and that SightLine needs a restart.
- The privacy notice now says keys are stored encrypted on this PC. The old text said Windows Credential Manager, which was wrong.
- In Settings, "Dock to the side during sessions" is now just "Dock to the side". The lone voice switch moved into the Voice section.

All tests pass, and so do the type-check and the build. I could not run the app itself, because there's no screen, audio or AI key here. The morning checklist below covers what to look at.

## What changed, commit by commit

1. **Setup screens and the old session record.** Deleted `GoalPrompt.tsx`, `ModeSelect.tsx`, `src/lib/sessionRecord.ts` and their tests.
2. **The old agents, setup calls, training and history.** This is the big one. These pieces were tangled together, so they had to go in one commit:
   - Agents removed: `tech-support.ts`, `training.ts` and `teacher.ts`.
   - Skills only they used: `pacing`, `verify`, `observe`, `review` and `socratic`, plus `tools/plan.ts` and `shared.ts`.
   - Also removed: the deferred research skill and its two fields, the per-mode memory lines, and the `withTools` path in the plan skill.
   - The `mode` value is gone everywhere. That covers `AppMode`, the registry (which now has one agent, and `allAgents` is gone), `agent:describe`, the next-instruction arguments, the turn context, the session store and the policy cache. `Agent` also loses `clarificationPrompt`, `planPrompt` and `maxClarifications`.
   - Removed from the turn result and both parsers: `needsResearch`, `researchQuery`, `taskVerdict` and `mistakePattern`. Also removed: `trainingContext`, `referenceFrame` and the plan-edit plumbing (`PlanEdit`, `PlanDraft`, `applyPlanEdits`).
   - Calls removed from `claude.ts`: `getClarifications`, `getSessionPlan`, `getCurriculumOutline`, `detailTrainingModule`, `getGoalEvaluation` and `runWebResearch`, along with their channels and `research:search` with its DuckDuckGo fallback. `runQuickWebResearch` stays.
   - Training is gone: `electron/training-plan.ts`, `trainingProgress.ts`, `CurriculumOutline.tsx`, the `plans:*` channels, plan storage, plan-frame storage, every `activePlan` branch, `startTrainingSession`, `finalizeTrainingPlan`, `MODE_META`, the "Done ✓" button with `markDone`, and the verdict card.
   - History is gone: the `history:*` channels, `SessionRecord` and `SessionSummary`, their store functions, and the `sessions`, `session_steps`, `session_turns` and `training_plans` tables in the Postgres text. `memory_facts.source_session_id` is now plain `text`.
   - Statuses removed: `clarifying`, `researching` and `evaluating`, with their labels and cards.
   - Store fields removed: `pauseReason`, `lastTtsEngine`, `researchQuery`, `clarificationContext`, `activePlan` and `mode`.
   - Loop branches removed: the training-turn handling, the legacy research branch, and both teacher-only branches.
3. **Unused channels and dead settings.** Removed `window:open-external`, `dock:set`, `captureIntervalSec` with the "Check frequency" control, and `historyEnabled` with the "Keep session history" switch.
4. **Unused design pieces and `@types/jsdom`.** Every piece was checked with a search before I deleted it.
   - Primitives removed: `Waveform`, `Cmd`, `Check`, `ChatInput`, `SpeakingStrip`, `StepRow`, `MiniStep` and `Panel`.
   - Icons removed: `IList`, `IMic`, `ISpark`, `ISupport`, `IClipboard`, `ICap` and `ICollapse`.
   - `@types/jsdom` was imported nowhere. `jsdom` itself stays because it's the test environment.
5. **Wording.**
   - Privacy notice: corrected how keys are stored.
   - Missing-key messages now name the variable, the `.env` file and the restart. That covers the Anthropic key in Settings and in the loop's error, and the OpenAI hint in Settings and in push-to-talk.
   - Settings labels: the docking wording and the Voice section, as described above.
   - `.env.example` and `docs/PRODUCTION.md`: where keys and chats are stored, which tables and store functions exist, and the manual-pass checklist.

`git diff --shortstat origin/one-coach...HEAD`, before this report was added: **65 files changed, 303 insertions(+), 5584 deletions(-)**

### Files deleted (19)

```
electron/agents/shared.ts
electron/agents/skills/observe.ts
electron/agents/skills/pacing.ts
electron/agents/skills/review.ts
electron/agents/skills/socratic.ts
electron/agents/skills/verify.ts
electron/agents/teacher.ts
electron/agents/tech-support.ts
electron/agents/tools/plan.ts
electron/agents/training.ts
electron/training-plan.ts
src/__tests__/sessionRecord.test.ts
src/__tests__/techSupportSkills.test.ts
src/__tests__/trainingPlan.test.ts
src/components/CurriculumOutline.tsx
src/components/GoalPrompt.tsx
src/components/ModeSelect.tsx
src/lib/sessionRecord.ts
src/lib/trainingProgress.ts
```

The coach's skill ids are still `"pacing"` and `"verify"`. Those ids belong to `stance.ts` and `check.ts`, which I did not touch. Only the old skill files with those names were deleted.

## Tests

| | Test files | Tests | Lint | Build |
| --- | --- | --- | --- | --- |
| Before (on `one-coach`) | 32 | 479 | pass | pass |
| After | 29 | 355 | pass | pass |

Every commit passed `npm test` and `npm run lint`.

Where the 124 tests went:
- **Deleted with the code they tested:** `sessionRecord.test.ts` (17), `trainingPlan.test.ts` (23) and `techSupportSkills.test.ts` (13). Also the curriculum case in `planSteps`, the teacher case in `loopGate`, and the setup-overview case in `muteConsistency`.
- **`agentPrompts.test.ts` went from 54 to 15, and `agentHarness.test.ts` from 37 to 8.**
  - Most of those were the same check repeated for each of the three agents. Each check now runs once, against the coach.
  - Removed outright: the checks that the agents stayed distinct from each other, training's grading, and the plan-edit merges, since that code no longer exists.
  - Removed as duplicates: checks that `coach.test.ts` already holds, namely the required fields, where `instruction` sits, the follow-up and first-look rules, the exact tool list, byte-identity and both cadences.
- **Kept, and now pointed at the coach:**
  - the prompt contains no per-look data
  - silence is its own tool and carries no speech fields
  - a follow-up is never answered with silence
  - the finished-step bounce, including that an agent with the switch off is left alone
  - history opens on a user turn
  - `max_tokens` keeps the previous lists
  - a response with no tool call ends silently
  - the coach caps a turn at 3 iterations
  - describe carries plain data only.
- **One wording check changed, and none were weakened.** The old first-turn guidance began "The session just started"; the coach's begins "This is your first look". `claude.prompt.test.ts` now checks the coach's wording. The rules that actually force a spoken first turn ("Do not call wait", "do not set digression=true") are still pinned word for word. Every other existing assertion passed against the coach unchanged.
- **One `coach.test.ts` check is now structural.** It used to read `coachAgent.clarificationPrompt`, but that field is gone from the type, so the check would no longer compile. It now asserts that the coach object has no such property, so the meaning is the same.

## What I left, and why

- **`LoopPolicy.requireScreenChange` stays.** It's now always true. Removing it would mean editing the coach's two preset objects, which `coach.test.ts` pins with `toEqual`, and the loop gate, which is on the leave-alone list. That isn't a small change, so I left the field. The loop gate's `false` branch is now unused but harmless.
- **The second mute button, the second attach button and `useVoice.ts` stay.** The plan lists them for removal, but the brief says to leave them because the screen is being redesigned and hold-to-talk needs a live check. Where the two disagreed, I followed the brief.
- **`TrainingActions` in `App.tsx` stays under its old name.** It draws the coach's "Check my work" and "I'm stuck" buttons in the watch stance, so it's live code. Renaming it would be a refactor.
- **The 0-based numbering of the plan in the coach's per-look context stays.** It only existed so the deleted plan-edit tools could point at a step. The text is part of what the coach reads on every look, though, so changing it would change behaviour. I updated the code comment only.
- **Old keys in `settings.json` stay.** A file that still has `captureIntervalSec` or `historyEnabled` keeps them; they're just never read. Writing code to strip them would mean rewriting saved data.
- **`waveColor` and `waveStops` in `src/design/theme.ts` stay.** Only the deleted `Waveform` used them. `theme.ts` wasn't on the list.
- **`CLAUDE.md` is unchanged, as the brief asks.** It still describes the three agents, training mode and the plan-frame exception. Step 12 rewrites it.

### What the leftover-term search found

I searched `electron/`, `src/` and `.env.example`. There are no matches for `activePlan`, `taskVerdict`, `getClarifications`, `history.` or `plans.`. What's left:

- **`tech_support` / `training`:** a stale comment in `src/lib/loopGate.ts`, a file on the leave-alone list. It has no effect on behaviour.
- **`training` in the coach's rules:** `skills/speech.ts` says "who the training is for", which is just everyday English inside a prompt rule. A comment in `skills/stance.ts` also mentions it, and that file is locked for tomorrow's live test.
- **`training`, `teacher`, `needsResearch` in comments that explain history:** these are in `chat-record.ts`, `db/store.ts`, `skills/research.ts`, `tools/research.ts` and `agentRunner.test.ts`.
- **`needsResearch` in `coach.test.ts`:** a check that these fields stay gone, which is why the names appear there.
- **Outside the code:** `CLAUDE.md` (step 12) and the plan and overnight docs mention all of these terms as plan text.

## Risks

- **I never ran the app.** The quiet-period trigger used to be switched on and off by `mode`. It now follows the open chat's id instead. Both get cleared on leaving a chat and set on starting or opening one, so the timing should be the same, but only a live run will confirm it.
- **The agent cadence is now fetched once for the life of the app**, rather than once per mode. There's only one agent now. A failed fetch still retries.
- **The red no-key notice in Settings depends on the key status being loaded.** The app loads it at startup, so it shouldn't flash for someone who has a key. Worth a glance.
- **"Encrypted on this PC" is true when Windows encryption is available**, which is normal. If it isn't available, `credentials.ts` falls back to storing keys as plain base64. That was already the case and I didn't touch it.
- **Two invisible, harmless side effects of my tooling:** while checking a prompt phrase, `npx` fetched the `tsx` tool into its own cache, not into the project. I also didn't subscribe this session to pull-request activity, because the rules say to stop after the report.

## Things that looked wrong but were out of scope

- **The privacy notice still says "Hit Pause or Stop".** There's no Stop button any more; it's "← Chats". The brief only asked me to fix the key wording there.
- **The Google TTS values are never stored encrypted.** They're read from `.env` on every start. `.env.example` now says so.
- **`CLAUDE.md` still describes the plan-frame screenshot exception**, which no longer exists. Step 12 should drop it.

## Morning checklist

1. Read the pull request's list of commits. Each one is a single kind of removal, so you can review or revert them one at a time.
2. Run `npm run dev` and type a quick goal. The coach should speak step one, and after you click something it should react within a couple of seconds. That second part is the quiet-period trigger in guide.
3. Say "just watch". It should go quiet and stop reacting to clicks. Then tap "Check my work" and you should get feedback.
4. Leave the chat with "← Chats", reopen it and hear the greeting. Then quit, relaunch and reopen it again.
5. Open Settings and check three things: Capture has no frequency buttons, Memory has no history switch, and there's one Voice section with the read-aloud switch at the top.
6. If you want to see the new message, temporarily rename your `.env` and restart. Starting a chat should open Settings with the red note about `ANTHROPIC_API_KEY`. Put the file back afterwards.
7. In the log, the `[loop]` lines should look the same as before, and the cache hit rate should not collapse.
