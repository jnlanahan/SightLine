# Review of the one-coach work (steps 0 to 6 and 8)

**Commit reviewed:** `9b22582b09d916eb00dfd2f3ab58d7a745a2edf6` (`one-coach` at the first fetch, 11 Nov 2026)

**Baseline in this sandbox:** `npm test` passed (32 files, 429 tests). `npm run lint` was clean. `npm run build` succeeded. No code was changed.

## In plain words

**How worried should you be? Not very.** Saving is solid. Chat files are written all at once, never half-way. Saves, opens and deletes run one at a time, in the order you trigger them. A deleted chat cannot come back. Nothing the screen sends to the background process can reach a file path unchecked. The spending cap still works. I found no way to lose a chat.

The problems I found are about the coach **going quiet when you expect it to talk**, plus two small memory gaps. The three most likely to show up in tomorrow's run:

1. **You leave a chat while the coach is thinking, then quickly reopen one or start a new one. The coach then says nothing for 15 to 60 seconds.** The loop from the old chat is still running and goes to sleep before it notices the new chat. Most visible when reopening a chat that was in "watch quietly" mode: about a minute of silence before the greeting. (Finding 1)
2. **The "welcome back" greeting can be skipped.** If the first look after reopening fails (a network blip, a rate limit, or you press Pause during it), the greeting is used up and never retried. If the model answers that look with silence, nothing catches it either. (Finding 2)
3. **Switching from "watch quietly" to "talk me through it" can leave the coach on the slow schedule for up to 2 minutes.** Your clicks still wake it, so this mostly shows if you sit still and wait for it to speak. (Finding 3)

## Findings, most serious first

### 1. A new or reopened chat inherits the old chat's sleeping loop
**Confirmed by reading the code.** `src/hooks/useSessionLoop.ts:741-770` and `:780-789`

**What happens:**
1. The coach is mid-look in chat A. You press Stop (`leaveChat`, which calls `reset()` and sets the status to idle).
2. Before that look's answer comes back, you open chat B from Home (or start a new goal), and the status becomes `watching`.
3. The status listener calls `runChain()`. That does nothing, because the old chain is still running: it is waiting on A's `tickRef.current("backstop")`.
4. A's look returns and is thrown away (wrong session). This part is correct. The old chain then sees status `watching` (B's), works out its delay from B's stance and calls `sleep(normalIntervalMs)`.
5. B's first look runs only when that sleep ends: 15 s if B is in guide, 60 s if B is in watch. The only thing that wakes it sooner is a click or keypress (and only in guide). For a reopened chat, this delays the greeting.

**Smallest fix:** in `runChain`, read `sessionId` before `await tickRef.current(...)`. If it has changed afterwards, `continue` and skip the sleep. Optionally, also call `cancelSleep?.()` from the status listener whenever `sessionId` changes.

### 2. The reopen greeting is used up before the call, so it can be lost
**Confirmed by reading the code.** `src/hooks/useSessionLoop.ts:289-290`, `:403-438`, `:466-473`, `:577`

`resumePending` is cleared as soon as the look starts. The greeting is lost on any of these paths:
- an error result: rate limit, network failure, or "Request failed. Retrying in 10s."
- a thrown error
- a result discarded because you pressed Pause or Stop during it

The next look is an ordinary, unprompted one. In watch stance, or when the screen hasn't changed, that look is usually `wait`. So you reopen a chat and hear nothing.

Separately, the resume prompt (`electron/agents/coach.ts:118`) says "You must call say on this turn, never wait". But the loop's safety net for a `wait` answer covers follow-ups only (`answeringFollowUp && action === "wait"`), so a resume look that returns `wait` goes unnoticed.

**Smallest fix:**
1. On the error, throw and discard paths, put the greeting back with `setResumePending(resuming)`. The pending follow-up has the same weakness, but that predates this work.
2. Extend the `wait` safety net to `resuming`. Treat the look as `acknowledge`, using the model's text or the record's `whereWeLeftOff`.

### 3. A stance change does not cut short a sleep already under way
**Confirmed by reading the code.** `src/hooks/useSessionLoop.ts:756-770`

The chain picks its delay after each of its own looks. A stance change that arrives from a look the chain didn't run is not seen until the chain's current sleep ends. Those looks are the follow-up tick (`:802-810`) and the input tick (`:862-872`). Example: in watch, the chain is in a 60 s sleep, or 120 s once the screen has been still. You type "talk me through it", and the follow-up look sets the stance to guide. For up to 2 minutes there is no backstop poll and no stall check-in, so on a still screen the coach waits for a click. The input trigger re-arms correctly (`:829-856`), and the per-look spacing reads the new stance at once.

**Smallest fix:** in the existing status listener, or a new one, call `cancelSleep?.()` when `state.stance !== prev.stance`.

### 4. Forgotten memory facts can come back once memory passes 400 facts
**Confirmed by reading the code.** `electron/db/store.ts:186-197`

A forgotten fact is kept as an archived entry, and that entry is what stops `memory:add` from learning it again. `isDuplicateFact` checks against `listFacts()`. When the list grows past `MAX_FACTS` (400), `saveFacts` sorts archived facts last and cuts them off first. After that, the coach's next `remember` of the same fact saves it as live again. This takes months of use, so it won't show tomorrow, but it breaks the "forget means forget" promise of step 6.

**Smallest fix:** give archived facts their own cap, so new live facts never push them out.

### 5. A note you corrected can come back in its old, wrong wording
**Confirmed by reading the code.** `electron/chat-notes.ts:108` and `:135-149`

`editNote` replaces the note's text in place. `addNote` blocks a repeat only when the text matches an existing note exactly, live or retired. Once you've corrected "Printer is HP 4100" to "Printer is HP 4200", the original wording exists nowhere. If the coach writes "Printer is HP 4100" again, for example after reading the same out-of-date screen, it is added as a new live note beside your correction.

**Smallest fix:** keep the replaced wording. Either retire the old note and add the corrected one as a new note, or store an `editedFrom` text and have `sameText` check it too.

### 6. Past-chat search misses ordinary word forms
**Confirmed** (checked by reading `stem()` and running it). `electron/memory-search.ts:79-86`

The suffix list checks `"es"` before `"s"`, and it removes `"ed"` even where the base word ends in "e". So "files"/"file", "updates"/"update", "updated"/"update" and "drives"/"drive" all produce different stems and don't match. A coach searching for "updates" finds nothing in a chat that said "update". The existing tests use only words that end in a plain "-s".

**Smallest fix:** drop the `"es"` rule. For `"ed"`/`"es"`, also try the stem with "e" added back, or simply match on either stem. Add "file"/"files" and "update"/"updated" to `memorySearch.test.ts`.

### 7. The step log can miss a step if the coach ever shortens or rewords its list
**Suspected; not likely given the current rules.** `electron/chat-record.ts:44-55`

`appendToStepLog` treats only entries past the log's length as new. If the coach ever sends a shorter or reworded list, for example by merging two old steps, then the same number of new steps go unlogged. The coach is then shown the log's wording again, so the two lists re-align, but the missed step is gone for good. The rule in `coach.ts:42` ("leave its wording alone … it only grows") makes this unlikely. The risk is highest in long watch-stance sittings, where the list gets long.

**Smallest fix (if it is ever seen):** log the entries of the coach's list that don't appear in the log, matched by normalised text, rather than slicing by length.

### 8. Small hardening gaps in the main process
**Confirmed by reading the code; not reachable from the app's own screen code.**
- `chats:save` (`electron/main.ts:1428`) checks the id but not the record's shape or size. A record with no `stepLog` would be written, and then `summarizeChat` would throw, leaving the chat out of the index.
- `memory:add` (`main.ts:1459`) doesn't check `kind` or the length of `content`. The 200-character limit is applied only in `parse-turn.ts`.
- `chats:get` returns any JSON that parses. A damaged file missing `stepLog` or `turns` makes `chatToSession` throw inside `openChat`, so clicking the chat silently does nothing.
- The one-time copy of `memory.json` into `data-v2` (`store.ts:171`) uses `copyFileSync` directly to the final name. A crash mid-copy would leave a truncated file, which reads as "no memory", and the copy never runs again. The old file stays untouched, so it is recoverable by hand. Copying to `.tmp` and then renaming closes this.

## Answers to the brief's questions

1. **Can a chat be lost or saved half-written?** No. Every write goes to a temp file and is then renamed into place. The store functions are synchronous, inside synchronous `ipcMain.handle` callbacks, so saves, opens and deletes run strictly in the order sent. `persistChat` builds its record and sends it before its first `await`, so leaving, quitting or deleting straight after is safe. Deleting from About this chat calls `reset()` first, so no autosave can follow it. Two quick opens resolve in order, and the last click wins. The only loss is minor: the cost of a look still running when you leave isn't added to the saved total (`useSessionLoop.ts:445`).
2. **Can the step log and the coach's list drift apart?** They can't stay apart: the coach is always shown the log's wording. A step can be missed only in the case in finding 7.
3. **After reopening, does the first look always happen? Can the greeting fire twice or never?** It can never fire twice, because the flag is cleared when used. It can fire never: see findings 1 and 2.
4. **Is there any path where the old cadence or the old input trigger stays in force?** The input trigger, no. It re-arms on every change of stance or chat and guards against out-of-order replies. The cadence, yes, for one sleep: see findings 1 and 3.
5. **Can an edited or forgotten note or fact come back, or be overwritten by an autosave?** Autosave can't overwrite your edits: the live store is the only copy, and the coach's note writes merge into it. A forgotten note stays forgotten unless the coach rewords it. An edited note can come back in its old wording (finding 5). A forgotten fact can come back after 400 facts (finding 4).
6. **Is the spending cap still enforced per sitting, and are the saved totals right?** Yes. The cap is checked before every call against the sitting's own `costUsd`, which starts at zero on every open. The saved total is `chatBaseRef` plus this sitting. Note that "per sitting" means leaving and reopening a chat starts the cap again; that is by design.
7. **Is anything from the renderer used in a file path or written to disk unchecked?** Every chat path goes through `chatFile()`, which accepts only `^chat_[a-z0-9]{1,40}$`, and ids read back from the index are checked the same way. Other paths are fixed. Record contents are written unchecked (finding 8).

## Checked and found sound
- `reset()` spreads `initial`, which contains every data field, including the new `stepLog`, `stance`, `resumePending`, `agentNotes` and `sessionId`. `openChat` calls `reset()` before `loadChat`, so nothing from a previous chat carries over.
- The stale-result discard and the in-flight guard are intact. Speech chunks and tool events check `sessionId` and `status`.
- The repeat guards are skipped on prompted turns (a follow-up or a resume), as intended. On reopen, the last spoken line is restored so the guard has something to compare against.
- First-words timing reports once per ask, only for a goal or a follow-up.
- Autosave is keyed on the notes array itself, so edits and forgets are saved. A chat isn't listed until the coach has spoken. Opening a chat re-saves it straight away, which only updates "last active".
- Mark done and delete mid-look: the in-flight result is discarded, and audio is cancelled.
- Older chats with plain-string notes load correctly, and nothing is written back.
- Memory search leaves out the open chat, forgotten facts and retired notes. It respects the memory setting, caps its results and needs no Electron.
- The new and edited Electron modules (`chat-record`, `chat-notes`, `memory-edit`, `memory-search`) are pure and covered by tests.

## Morning checklist
- [ ] Open a chat, press Stop while the coach is thinking, and reopen it straight away. Does the greeting come within a few seconds? (Finding 1)
- [ ] Reopen a chat that was in "watch quietly". Is there a greeting at all, and how long does it take?
- [ ] In watch, say "talk me through it", then keep still. Does it guide within about 15 s? (Finding 3)
- [ ] Correct a note in About this chat, then carry on. Does the old wording reappear? (Finding 5)
- [ ] In `sightline.log`, grep `[loop]` for `result discarded` followed by a long gap before the next `→ Claude`.
