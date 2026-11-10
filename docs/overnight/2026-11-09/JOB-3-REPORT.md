# Job 3 report: the coach can search past chats (plan step 8)

Branch: `claude/overnight-2026-11-09-search`
Started from: `claude/overnight-2026-11-09-memory` (job 2's branch, which already includes job 1). It existed on origin and its tests passed, so the pull request targets that branch, not `one-coach`.

## In plain words

The coach can now look back through your earlier chats while it is answering. If you say "like last time" or the problem on screen looks familiar, it can search your old chats and the facts it has saved about you, and get back up to five short snippets, each saying which chat it came from and when you last had it open. It can then say "we fixed this in March by turning off the VPN".

The search runs on your PC. There is no AI call, no new download and no index file. It only reads files the app already saves. While it runs, the status line says "Checking earlier chats…". It does nothing when "Remember me between sessions" is off.

None of this has been run live. There was no screen, audio or AI key here, so everything below is checked by tests only.

## What changed

**A search function** in `electron/memory-search.ts`. It has no Electron or disk code, so it can be tested on its own.
- It searches fact text and, for each chat, the title, goal, where-we-left-off line, notes, step log and conversation.
- Scoring uses the existing keyword helper in `electron/memory-rank.ts`, plus a light word-ending match so "uploads", "uploading" and "uploaded" all find "upload".
- A match in the title or goal counts most (1.0), then notes (0.9), where it was left (0.8), the step log (0.7) and the conversation (0.5). Facts count 0.9.
- When scores are close, the more recent chat wins. A year-old chat keeps 85% of its score, so a much better old match still beats a weak recent one.
- At most 5 results and one per chat. Each snippet is at most 300 characters around the match. The title is printed with every result, so the snippet comes from the best match outside the title.
- It never returns the chat you are in now, notes you forgot or that were pushed out, forgotten facts, or facts already loaded into this chat.
- To keep the cost down it reads the chat list, then at most the 100 most recently active chat files.

**One new tool, `search_memory(query)`** (`electron/agents/tools/memory-search.ts`). The search reaches it through the same dependency list as the web search and the zoom tool, so the coach's code still has no Electron in it. `electron/main.ts` does the file reading.

**One new skill, `pastChats`** (`electron/agents/skills/past-chats.ts`). It adds the tool and one short rule: use it when the user refers to something from before or the problem looks familiar, not on every look, and never read results back as a list.

**`electron/agents/coach.ts`**: one line added, putting the skill directly after the screen-reading skill. The coach's rules, `stance.ts` and `check.ts` are not touched. The coach still gets three tool round trips per look.

**The renderer** sends the open chat's id (`sessionId`) with each look as `chatId`, and shows "Checking earlier chats…" in both places that show tool status (`src/App.tsx`, `src/components/Instruction.tsx`). Unlike a web search, no "let me look that up" filler is spoken, because this search is local and quick.

### New tool order

This changes the cached prefix once, as the brief expects. The pins in `coach.test.ts` were updated on purpose.

| # | Before | After |
| --- | --- | --- |
| 1 | `say` | `say` |
| 2 | `wait` | `wait` |
| 3 | `search_web` | `search_web` |
| 4 | `read_screen_region` | `read_screen_region` |
| 5 | | `search_memory` |

Skill order: speech, pacing, verify, troubleshoot, research, screenReading, **pastChats**, plan, pointing, notes, memory.

## Worked examples

These are real outputs from the search function on test data like the data in `memorySearch.test.ts`. The open chat is "OneDrive won't sync". This is the exact text the coach reads.

**Query "onedrive sync"**
```
1. Chat "Fix OneDrive sync" (last active 15 Mar 2026, 240 days ago), your note: VPN blocks the OneDrive sync port; turning it off fixes uploads
2. Chat "Tidy the desktop" (last active 8 Nov 2026, 2 days ago), conversation: User: Unrelated, but my OneDrive sync failed again.
3. Saved fact about the user (setup): Uses the OneDrive desktop app, not the web version
Use what helps in your own words — don't read these back as a list.
```
The old chat about the same problem comes first even though it is eight months old, because the match is in its title. The open chat is left out.

**Query "zoom installer error 1603"**
```
1. Chat "Install Zoom" (last active 11 Oct 2026, 30 days ago), conversation: Coach: That error 1603 means the installer could not write to Program Files.
```

**Query "kubernetes"** (nothing matches)
```
Nothing in earlier chats or saved facts matches "kubernetes". Carry on from what you can see; don't tell the user you searched unless they asked.
```

## Tests

| | Test files | Tests |
| --- | --- | --- |
| Before (job 2's branch) | 31 | 397 |
| After | 32 | 429 |

`npm run lint` and `npm run build` pass before and after. Each commit passed `npm test` and `npm run lint`.

New tests:
- `src/__tests__/memorySearch.test.ts` (26 tests) covers ranking (title or goal over transcript, note over transcript, more words matched over fewer, recency on ties but not over a much better match, word endings, facts and chats together, one result per chat), the five-result cap, the 300-character snippet, the 100-chat read limit, leaving out the current chat, retired notes, archived facts and already-loaded facts, and empty queries and empty stores.
- `src/__tests__/agentRunner.test.ts` (5 more) wires the tool through fake dependencies. Results reach the model. An empty result says so plainly. An empty query is refused. The tool reports when it starts. A failing search does not fail the look: the coach still speaks, and the tool is withdrawn for the rest of that look like any failed tool.
- `src/__tests__/coach.test.ts`: tool and skill order pins updated, and one new check that the prompt carries the "not every look, never read back as a list" rule.

## Calls I made, and why

- **"Remember me" off means no search.** The switch reads "Remember me between sessions", and searching old chats is remembering between sessions. When it is off, the search returns nothing and logs `[memory] search skipped: memory is off`. This is the conservative reading. If you want chats searchable even with it off, it is a one-line change in `electron/main.ts`.
- **Facts already loaded into this chat are skipped**, as plan step 8 says ("facts that were not loaded"). This is done by checking whether the fact's text appears in the loaded memory block.
- **The search reads files directly in the main process.** Up to 100 small JSON files are read one after another per search. That is fast for chats of normal size. A chat with a very long transcript or large attached files would make it slower. Attached files are not searched.
- **Scores are not cut off at a minimum.** Any keyword hit counts. With five results at most, it seemed better to show a weak lead than to show nothing.
- **CLAUDE.md is not updated.** The plan leaves that to step 12.

## Risks

- **Cache:** the tool list sits ahead of the cached prompt, so the first look after this change writes a new cache. After that the hit rate should look as it did before. If it stays low, something else is wrong.
- **Overuse:** the rule says not to search on every look, but only a live run shows whether the coach follows it. Each search is a round trip the user waits through. Look for `[tool] search_memory` lines in the log.
- **Keyword limits:** "laptop" will not find "notebook". This is plain keyword matching, as the brief asked.
- **Main-process stall:** reading 100 files blocks the main process briefly. It is not a problem at today's sizes, but it would be the first thing to move off the main thread if chats grow large.

## Morning checklist

1. Read the diff, about 870 added lines including tests and this report. Most of it is `electron/memory-search.ts` and its tests.
2. Run the app from this branch. In an older chat, make sure something distinctive happened (for example, a fix you talked through).
3. Start a **new** chat and ask "what did we do about <that problem> last time?" The status line should briefly read "Checking earlier chats…", and the coach should answer from the old chat in its own words, not as a list.
4. In `%APPDATA%/sightline/logs/sightline.log`, look for `[tool] search_memory "…"` and `[memory] search "…" over N chat(s): M hit(s)`.
5. Check that the coach does **not** search on ordinary looks. Search lines should only appear when you mention the past or hit a familiar problem.
6. Check that the logged cache hit rate recovers after the first look.
7. Optional: turn off "Remember me between sessions", ask again, and confirm the coach finds nothing.

## Pull request body

(Also used for the pull request. Kept here in case it could not be opened.)

> **Plan step 8: the coach can search past chats** (overnight job 3)
>
> Base: `claude/overnight-2026-11-09-memory` (job 2, which includes job 1).
>
> - New pure `electron/memory-search.ts`: keyword search over facts and other chats (title, goal, where-we-left-off, notes, step log, transcript), using the `memory-rank.ts` keyword helper. At most 5 results, 300-character snippets, recency breaks near-ties. Never returns the open chat, retired notes, archived facts or already-loaded facts. Reads the index, then at most the 100 most recent chat files.
> - New mid-look tool `search_memory(query)` via `ToolDeps.searchMemory`, and new skill `pastChats` placed after `screenReading` in `coach.ts`. This is the one permitted edit there, and it changes the cached tool order once (pins updated). The coach's rules are untouched. `maxToolIterations` stays 3.
> - The renderer passes `chatId` (`sessionId`). The status line reads "Checking earlier chats…".
> - Skipped when "Remember me" is off.
> - Tests: 397 → 429. Lint and build pass. Not run live.
>
> Report: `docs/overnight/2026-11-09/JOB-3-REPORT.md`
