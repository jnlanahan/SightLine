# Review job: everything built so far (read-only)

Follow every rule in `docs/overnight/2026-11-09/README.md`. This job changes no code.

**Branch:** from `one-coach`, named `claude/overnight-2026-11-09-review`.

This brief was updated on 10 November. The first attempt at this job never ran, and since then steps 5, 6 and 8 have been merged. Work continues on `one-coach` while you review, so review the commit you find at your first fetch, and write that commit's hash at the top of your report.

## Why

Steps 0 to 6 and step 8 of `docs/ONE-COACH-PLAN.md` have never been run. They pass about 430 unit tests, but most of the changed renderer code has no tests behind it, and steps 5, 6 and 8 were built by unattended jobs. The owner is about to try the app. Find what is likely to break before they do.

## What to review

Everything in `git diff main...origin/one-coach`, with the most care where tests are thinnest:

- `src/App.tsx`: starting a chat (`startSession`), reopening one (`openChat`), saving (`persistChat` and the autosave effect), leaving (`leaveChat`), quitting, marking done and deleting from About this chat, and the running totals kept in `chatBaseRef`.
- `src/hooks/useSessionLoop.ts`: the stance (cadence picked per stance, the input trigger re-arming when the stance or the open chat changes), the one-shot resume flag, the first-words timing, and the repeat guards keyed on `prompted`.
- `src/store/session.ts`: `applyCompletedSteps`, `loadChat`, the note actions, and whether `reset()` clears everything it should.
- `src/components/Home.tsx`, `ProgressRail.tsx`, `AboutChat.tsx` and the memory list in `Settings.tsx`: the chat list, delete, the step log with times, editing and forgetting notes and facts.
- `electron/chat-record.ts`, `electron/chat-notes.ts`, `electron/memory-edit.ts`, and the chat functions in `electron/db/store.ts`: the `data-v2` folder, the one-time copy of `memory.json`, the index, the id check, reading chats saved in the older note shape.
- `electron/memory-search.ts`, `electron/agents/tools/memory-search.ts` and its wiring in `electron/main.ts` and `electron/claude.ts`.
- `electron/agents/harness/`: `parse-turn.ts`, `runner.ts`, `context.ts`.
- `electron/agents/coach.ts` and everything in `electron/agents/skills/`: read the assembled prompt as the model would. Look for rules that contradict each other, and for anything that would make the coach talk when it should be quiet or stay quiet when the user is waiting.
- What step 5 deleted: look for anything still reachable that depended on it.

Questions worth answering directly:

1. Can a chat be lost or saved half-written (leave mid-turn, quit mid-turn, reopen while a save is in flight, two quick opens, delete while a save is in flight)?
2. Can the step log and the coach's own list of completed steps drift apart, or a step be missed because the log only looks at list length?
3. After reopening, does the first look always happen, and can the greeting fire twice or never?
4. When the stance changes, is there any path where the old cadence or the old input trigger stays in force?
5. Can a note or fact the user edited or forgot come back, or be overwritten by an autosave?
6. Is the spending cap still enforced per sitting, and are the saved totals right across several sittings?
7. Is anything that arrives from the renderer used in a file path, or written to disk, without being checked?

## Deliverable

`docs/overnight/2026-11-09/REVIEW.md`:

- The commit hash you reviewed.
- A plain-words summary first: how worried should the owner be, and the three things most likely to go wrong in a live run.
- Then findings, most serious first. For each: what is wrong, `file:line`, the exact sequence that triggers it, and the smallest fix. Mark each as **confirmed by reading the code** or **suspected**.
- A short list of what you checked and found sound.
- Do not pad it. No finding is better than a weak one.

Commit only that file, open the pull request against `one-coach`, and stop.
