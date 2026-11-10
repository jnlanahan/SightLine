# Overnight job: review steps 0 to 4 (read-only)

Follow every rule in `docs/overnight/2026-11-09/README.md`. This job changes no code.

**Branch:** from `one-coach`, named `claude/overnight-2026-11-09-review`.

## Why

Steps 0 to 4 of `docs/ONE-COACH-PLAN.md` were built in one day and have never been run. They pass 479 unit tests, but most of the changed renderer code has no tests behind it. The owner will try the app tomorrow. Find what is likely to break before they do.

## What to review

Everything in `git diff main...origin/one-coach`, with the most care where tests are thinnest:

- `src/App.tsx`: starting a chat (`startSession`), reopening one (`openChat`), saving (`persistChat` and the autosave effect), leaving (`leaveChat`), quitting, and the running totals kept in `chatBaseRef`.
- `src/hooks/useSessionLoop.ts`: the stance (cadence picked per stance, the input trigger re-arming when stance changes), the one-shot resume flag, the first-words timing, and the repeat guards now keyed on `prompted`.
- `src/store/session.ts`: `applyCompletedSteps`, `loadChat`, and whether `reset()` clears everything it should.
- `src/components/Home.tsx` and `src/components/ProgressRail.tsx`: the chat list, delete, and the step log with times.
- `electron/chat-record.ts` and the chat functions in `electron/db/store.ts`: the `data-v2` folder, the one-time copy of `memory.json`, the index, the id check.
- `electron/agents/harness/`: `parse-turn.ts` (stance; an omitted `upcoming_steps` keeps the plan), `runner.ts` (the finished-step bounce is skipped in watch), `context.ts` (resume block, stance-aware wording).
- `electron/agents/coach.ts`, `skills/stance.ts`, `skills/check.ts`: read the assembled prompt as the model would. Look for rules that contradict each other, including against the shared `skills/speech.ts`, `skills/troubleshoot.ts` and `skills/plan.ts`, and for anything that would make the coach talk when it should be quiet or stay quiet when the user is waiting.

Questions worth answering directly:

1. Can a chat be lost or saved half-written (leave mid-turn, quit mid-turn, reopen while a save is in flight, two quick opens)?
2. Can the step log and the coach's own list of completed steps drift apart, or a step be missed because the log only looks at list length?
3. After reopening, does the first look always happen, and can the greeting fire twice or never?
4. When the stance changes, is there any path where the old cadence or the old input trigger stays in force?
5. Does anything still reachable depend on the old agents, the setup flow or the training plan in a way that could throw?
6. Is the spending cap still enforced per sitting, and are the saved totals right across several sittings?

## Deliverable

`docs/overnight/2026-11-09/REVIEW-steps-0-4.md`:

- A plain-words summary first: how worried should the owner be, and the three things most likely to go wrong in a live run.
- Then findings, most serious first. For each: what is wrong, `file:line`, the exact sequence that triggers it, and the smallest fix. Mark each as **confirmed by reading the code** or **suspected**.
- A short list of what you checked and found sound.
- Do not pad it. No finding is better than a weak one.

Commit only that file, open the pull request against `one-coach`, and stop.
