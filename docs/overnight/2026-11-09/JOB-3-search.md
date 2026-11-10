# Overnight job 3: the coach can search past chats (plan step 8)

Follow every rule in `docs/overnight/2026-11-09/README.md`.

**Branch:** start from the first of these that exists on origin and passes its tests: `claude/overnight-2026-11-09-memory`, `claude/overnight-2026-11-09-trim`, `one-coach`. Name yours `claude/overnight-2026-11-09-search`. Open the pull request against the branch you started from, and say which it was.

## Goal

The coach can look up something from an earlier chat when it needs it, so it can say "we fixed this in March". Only a small, ranked slice of memory is loaded into every look; everything else should be reachable on demand. The spec is `docs/ONE-COACH-PLAN.md`, step 8.

## Build

**A pure search function**, in a new file under `electron/` with no Electron or file-system imports, so it is unit-testable.
- Input: a query, the stored facts about the user, and saved chats. Output: at most five results, best first.
- It searches fact text, and for each chat its title, goal, where-we-left-off line, notes, step log and transcript.
- Scoring reuses the keyword helper in `electron/memory-rank.ts`. Prefer a match in a title, goal or note over one deep in a transcript, and prefer more recent chats when scores are close.
- Each result says where it came from (a fact, or a chat with its title and the date it was last active) and carries a snippet of at most 300 characters around the match.
- It never returns the chat the coach is in now. It skips retired notes and archived facts.

**One new tool the coach can call mid-look**, `search_memory(query)`.
- Follow the pattern of `electron/agents/tools/research.ts` and `tools/screen.ts`. The search itself arrives through `ToolDeps`, so the agent code stays free of Electron. Wire it in `electron/claude.ts` and `electron/main.ts`, reading chats through the store.
- Cost: reading every saved chat on each call is wasteful. Read the index, then at most the 100 most recently active chat files.
- A new small skill adds the tool and a short rule: use it when the user refers to something from before, or the problem looks like one met before; not on every look; never read results back as a list.
- Add that skill to the coach's list in `electron/agents/coach.ts`, directly after the screen-reading skill. This is the one permitted edit to that file. It changes the tool order in the cached prefix, which is expected: update the pins in `coach.test.ts` on purpose.
- The tool needs to know which chat is open. The renderer already holds the chat id as `sessionId`; pass it through with the other next-instruction arguments.
- While it runs, the status line should read "Checking earlier chats…". See how `search_web` gets its status text in `src/App.tsx`.
- Each tool call is a round trip the user waits through. The coach's budget of three tool round trips per look stays as it is.

## Leave alone

- The rules in `coach.ts` (apart from the one-line list change), `skills/stance.ts`, `skills/check.ts`.
- How memory is written, and the screens that show it (job 2).
- No embeddings, no index files, no new dependencies. Keyword search over a few hundred small files is enough.

## Tests

The search function: ranking, the five-result cap, the snippet length, that the current chat is excluded, that retired and archived items are skipped, that an empty query or an empty store returns nothing. The tool: wired through fake dependencies in the style of `agentRunner.test.ts`, including a failing search, which must not fail the look.

## Report

`docs/overnight/2026-11-09/JOB-3-REPORT.md`. Include the new tool order, two or three worked examples of query and results from your tests, and a morning checklist: in a new chat, ask what was done about a problem from an older chat and hear the coach answer from it.
