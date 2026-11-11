# Overnight sessions, 10 to 11 November 2026: the redesign

Three cloud sessions build the redesign, steps 13 to 22 of [the plan](../../ONE-COACH-PLAN.md), one after another. They share one branch and one pull request. None of them touches `main` or commits to `one-coach`, so the app the owner is about to test stays exactly as it was left.

| Session | Starts (Eastern) | Aim | 
| --- | --- | --- |
| 1 | 11:00 PM, 10 Nov | Steps 13, 14, 15 (colours and type; messages know their step; the rail) |
| 2 | 4:00 AM, 11 Nov | Steps 16, 17, 18 (phase chat; replies, pill and scrolling; header, message box, quick layout, switch-over) |
| 3 | 9:00 AM, 11 Nov | Steps 19, 20, 21, then the machine half of step 22 (states; removals; recolour the other screens; check) |

The aims are a guide, not a boundary. **Every session starts at the first step that is not marked done in `PROGRESS.md` and works forward in order.** If an earlier session fell short or never ran, the next one picks up where things actually stand. If a session finishes its aim with time to spare, it carries on with the next step. No step is ever skipped.

Left for the owner on purpose, because they need a screen, a voice or a decision: the manual run in step 22 (`docs/redesign/IMPLEMENTATION.md`, WP10 points 1 to 9), choosing the default colour set, and merging.

## Setting up (every session)

1. `git fetch origin`. The shared branch is `claude/overnight-2026-11-10-redesign`.
   - If `origin/claude/overnight-2026-11-10-redesign` exists: check it out and `git pull --ff-only`.
   - If it does not: `git checkout -b claude/overnight-2026-11-10-redesign origin/one-coach`.
2. Read, in this order:
   - `CLAUDE.md`
   - `docs/ONE-COACH-PLAN.md`: Progress, "The redesign: phase chats", "Things that must stay true", and "Steps 13 to 22: the redesign"
   - `docs/redesign/README.md`, then `DECISIONS.md`, `SPEC.md`, `DATA.md`, `IMPLEMENTATION.md`, `tokens.ts`, and `reference/README.md`. Open the two reference prototypes when the spec is silent on something.
   - `docs/overnight/2026-11-10/PROGRESS.md` and any `SESSION-*-REPORT.md` already in this folder.
3. `npm ci`. If it fails downloading the Electron binary, use `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`; the tests do not need the binary.
4. Before your first edit, run `npm test`, `npm run lint` and `npm run build` and write down the results. On `origin/one-coach` there are 536 passing tests. If the branch is red when you arrive, fixing that is your first job; say what was wrong in your report. If `npm run build` fails in this sandbox for a reason unrelated to the code, say so and rely on test and lint.

## Which document wins

1. `docs/ONE-COACH-PLAN.md`, sections "The redesign: phase chats" and "Steps 13 to 22". It was written after the design, against the code as it is now, and corrects several things the design's documents assume.
2. `docs/redesign/SPEC.md` and `tokens.ts`: use every measurement and colour exactly.
3. `docs/redesign/IMPLEMENTATION.md` and `DATA.md`.
4. The reference prototypes.

Where all four are silent, make the conservative choice and list it in your report under "Calls I made".

## While working

- You are alone. The owner cannot answer questions.
- You cannot run the app: there is no screen, no audio and no AI key here. Do not try, and do not add keys.
- Use git and this repository only. Do not use any connected service (email, files, calendar, notes, documents), even if one is available to you.
- Never commit to `main` or to `one-coach`. Never force-push. Never merge a pull request. Never rewrite commits already on the shared branch.
- **One step, one commit, in order.** A step is one work package. Finish it, get `npm test` and `npm run lint` green, commit, push, update `PROGRESS.md`, then start the next. Never leave the branch red: if you cannot get a step green, discard that step's uncommitted work, write down exactly what blocked it, and stop.
- **Do not start a step you cannot finish.** A half-built step is worse than a missing one for the session that follows. If you are running short, stop after the last green commit.
- **What you may not change.** This is screen work. Do not edit anything under `electron/agents/`, `electron/tts/`, or the capture, calibration and docking files (`capture.ts`, `calibrate*.ts`, `dock*.ts`). Do not change the loop's guards, gates, timings or log lines in `src/hooks/useSessionLoop.ts`; the single added line for the pointing flag (plan, WP5) is the only edit allowed there. Do not rewrite the hold-to-talk logic in `Composer.tsx`. If a step seems to need any of this, stop and explain why in your report.
- **What main-process edits are expected:** `electron/types.ts` (the `palette` setting; the two turn fields), `electron/settings-store.ts` (the default and the one-time accent-to-palette read), `electron/main.ts` (the glow colour by palette), `electron/db/schema.ts` and `electron/chat-record.ts` (the two turn fields). Nothing else.
- One new dependency is allowed: `@fontsource-variable/manrope`. No others.
- Do not write code that deletes or rewrites the user's saved chats or settings on disk beyond the one-time settings read described in WP1. Old chats must still open.
- Tests that pin today's behaviour (`muteConsistency.test.ts`, `dockSettings.test.ts`, the loop timing tests) are changed only on purpose, and each such change is named in your report with the reason.
- Never print, log or commit a secret.
- Add the tests each work package lists. Do not delete a test to make it pass.

## Finishing (every session)

- **Commits:** `redesign step N (WPn): what it does`. Each message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **`PROGRESS.md`** in this folder: one line per step, 13 to 22, marked `done` (with the commit), `partly` (say what is left) or `not started`. Keep it current after every step; it is how the next session knows where to start.
- **Pull request:** one, from the shared branch into `one-coach`. If none exists, open it with `gh pr create --base one-coach`; if one exists, leave it and just push. The body says which steps are done and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. If `gh` is unavailable, push the branch and put the intended body in your report.
- **A report:** `SESSION-1-REPORT.md`, `SESSION-2-REPORT.md` or `SESSION-3-REPORT.md` in this folder. The owner is not a developer. Lead with a plain-words summary, then: which steps you finished; what you left and why; test counts before and after; "Calls I made" (every place the spec was silent or you departed from it); risks; and what the next session should know.
- **Session 3, or whichever session finishes step 21,** also does the machine half of step 22 and writes `MORNING.md` in this folder:
  - `npm run lint`, `npm test` and `npm run build` results.
  - The acceptance checklist from the end of `docs/redesign/IMPLEMENTATION.md`, each item marked "checked by a test", "checked by reading the code" or "needs the owner's eyes", with one line of evidence.
  - A search of the new screen's wording for the words the spec bans (session, capture, tokens, stance, stage).
  - The owner's manual run, copied from WP10 points 1 to 9, as a tick list in plain words.
  - The three things most likely to be wrong, in your honest judgement.
- Then stop.
