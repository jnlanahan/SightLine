# Overnight jobs, 9 November 2026

Four cloud jobs, set up at the end of the day steps 0 to 4 of [the plan](../../ONE-COACH-PLAN.md) were built. None of them touches `main` or commits to `one-coach` directly. Each one works on its own branch and opens a pull request against `one-coach`, so the branch the owner is about to try stays exactly as it was left.

| Job | Starts (Eastern) | What it does | Branch |
| --- | --- | --- | --- |
| Review | 11:00 PM | Reads steps 0 to 4 looking for bugs. Changes no code; writes a findings report | `claude/overnight-2026-11-09-review` |
| 1 | 11:45 PM | Plan step 5: removes everything the one coach replaced | `claude/overnight-2026-11-09-trim` |
| 2 | 2:15 AM | Plan step 6: memory you can see and correct | `claude/overnight-2026-11-09-memory` |
| 3 | 4:45 AM | Plan step 8: the coach can search past chats | `claude/overnight-2026-11-09-search` |

Jobs 1, 2 and 3 stack: each starts from the previous job's branch if it exists, otherwise from `one-coach`.

Left for daytime on purpose, because they need a live run or a decision: step 7 (long projects, which changes the coach's rules), step 9 (tidy-up, a new AI call), step 10 (model comparison), step 11 (caching), step 12 (wrap up).

## Rules every job follows

**Setting up**

1. `git fetch origin && git checkout one-coach && git pull --ff-only`. The job briefs live only on this branch.
2. Read, in this order: `CLAUDE.md` (it describes the app BEFORE this work; where it disagrees with the plan, the plan wins), `docs/ONE-COACH-PLAN.md` (Progress, Calls I made, Things that must stay true, and the step you are doing), `docs/REDESIGN-BRIEF.md`.
3. `npm ci`. If it fails downloading the Electron binary, use `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`; the tests do not need the binary.
4. Before your first edit, run `npm test`, `npm run lint` and `npm run build` and write down the results. If `npm run build` already fails in this sandbox for a reason unrelated to the code, say so in your report and rely on test and lint.

**While working**

- You are alone. The owner cannot answer questions. Make the conservative choice and explain it in your report.
- You cannot run the app: there is no screen, no audio and no AI key here. Do not try, and do not add keys.
- Use git and this repository only. Do not use any connected service (email, files, calendar, notes), even if one is available to you.
- Never commit to `main` or to `one-coach`. Never force-push. Never merge a pull request.
- No new dependencies. Keep the code style. Do not refactor code your job does not need to change.
- Do not edit the wording of the coach's rules in `electron/agents/coach.ts`, `electron/agents/skills/stance.ts` or `electron/agents/skills/check.ts`. The owner is trying those live tomorrow. (Job 3 adds one skill to the list in `coach.ts`; that is the only exception.)
- Do not write code that deletes or rewrites the user's saved data on disk, in either the old `data` folder or the new `data-v2` folder.
- Never print, log or commit a secret.
- `npm test` and `npm run lint` must pass at every commit.

**Finishing**

- Commits: one per logical unit. Each message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- One pull request against `one-coach` (against the previous job's branch if you stacked on it; say which). The body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. If `gh` is unavailable, push the branch and put the body in your report.
- A report file in this folder, named in your brief. The owner is not a developer: lead with a plain-words summary, then what changed, what you left and why, test counts before and after, risks, and a short morning checklist of things to look at.
- Then stop.
