# Job 2 report: memory you can see and correct (plan step 6)

Branch: `claude/overnight-2026-11-09-memory`, started from **`claude/overnight-2026-11-09-trim`** (job 1's branch existed on origin and its tests, type-check and build all passed). The pull request is against that trim branch, not `one-coach`.

## In plain words

You can now see what the coach remembers, fix it, and make it forget things. You can also tell what it actually saw on your screen apart from what it was told or guessed.

- **Inside a chat**, a new ⓘ button in the bottom bar opens **About this chat**. It shows the goal, where the chat was left, the coach's notes for this chat, and attached file names. Each note says **Seen on screen** or **Not yet confirmed**. You can edit a note, forget it, mark the chat done, or delete the chat (it asks first).
- **In Settings**, the "Review what it remembers" list (**About you**) now shows the same mark on each fact and has **Confirm**, **Edit** and **Forget**.
- **Behind the scenes**, the coach now says, each time it writes a note or a fact, whether it read it on screen. Facts it saw get a small boost when it decides what to recall. Facts it didn't see are marked "unconfirmed" when they are handed to it.

**I could not see either screen.** There is no display here. They are built from the existing styles and should look like the rest of the app, but the layout has not been checked by eye.

## What changed

Two code commits plus this report.

**1. Notes and facts record whether the coach saw them** (`61cc445`)

- A chat's notes are no longer plain text. Each note has an id, its text, a `seen` flag, the time it was written, and a retired time (`ChatNote` in `electron/db/schema.ts`, with the Postgres text changed alongside it).
- New pure module `electron/chat-notes.ts`:
  - **Cap of 30 live notes.** When a new note would go over, the oldest live note is retired. Retired notes stay in the saved chat and are not shown to the coach or to you.
  - **Forgotten stays forgotten.** If the coach writes a note that matches one already in the chat, live or retired, it is not added again. That covers a note you forgot and a note the cap pushed out. If it matches a live note and this time the coach saw it on screen, the live note is marked seen.
  - Edit and forget helpers, used by the screen.
- **Facts:** `MemoryFact` gains an optional `verified` flag. `memory:add` stores the coach's `seen` as `verified`. If the coach later sees on screen a fact it had only been told, the stored fact is marked verified, unless you forgot it.
- **Recall (`electron/memory-rank.ts`):** verified facts get a ×1.15 boost. Unverified facts appear to the coach as `(kind, unconfirmed)` with one sentence saying what that means. The sentence is left out when every fact is verified.
- **New channel `memory:update`:** changes a fact's wording or marks it confirmed. The rules are in a pure helper, `electron/memory-edit.ts`, and `main.ts` only reads and writes the file around it. A forgotten fact cannot be edited, because editing would bring it back.
- **The coach's instructions:** one sentence in `skills/notes.ts` and one in `skills/memory.ts` saying when to set the new flags. I did not touch `coach.ts`, `stance.ts` or `check.ts`.
- **The session loop** shows the coach only live notes, passes the two flags through, and logs `seen` on remembered facts.

**2. About this chat and About you** (`ec114e3`)

- New `src/components/AboutChat.tsx`, opened from the ⓘ button in the control bar or from an "About this chat" button in the plan drawer's Context row. The notes list that used to sit in that row is gone, as the brief asked.
- `Settings.tsx` → `MemoryList` now has a mark, Confirm, Edit and Forget on each fact.

## The coach's `say` and `wait` fields, before and after

This change re-writes the cached prefix once, which is expected. The pins in `coach.test.ts` were updated on purpose: there is now a test that pins both lists exactly.

| | Fields |
| --- | --- |
| `say` before | action, instruction, code, expected_pace, stance, expected_result, troubleshooting, completed_steps, upcoming_steps, digression, highlight, notes, remember |
| `say` after | action, instruction, code, expected_pace, stance, expected_result, troubleshooting, completed_steps, upcoming_steps, digression, highlight, notes, **note_seen**, remember |
| `wait` before | stance, troubleshooting, completed_steps, upcoming_steps, digression, notes, remember |
| `wait` after | stance, troubleshooting, completed_steps, upcoming_steps, digression, notes, **note_seen**, remember |

`remember` also gains an optional `seen` boolean inside it, next to `kind` and `content`. Both new flags are optional, and leaving one out means "not seen". Only an exact `true` counts, so a stray `"true"` string is never shown as seen.

## How old saved data is handled

Nothing on disk is rewritten or deleted by this job.

- **Chats saved before tonight** hold notes as plain strings. On read, each becomes a note marked **not seen**. Its time is the chat's creation time, and its id comes from its position (`note_old0`, `note_old1`, …), so the same old file always converts the same way. Blank or unreadable entries are skipped. The file changes only the next time the chat is saved in the ordinary way, and then it is saved in the new shape. Conversion happens in `normalizeChatRecord` (when `getChat` reads the file) and again in `chatToSession`, so a record from any source restores correctly.
- **Facts saved before tonight** have no `verified` field. Missing is treated as false, so they show as "Not yet confirmed" and get no boost. I made the field optional instead of filling it in on read, so nothing touches `memory.json` until you or the coach change a fact.

## Things I decided alone (conservative choices)

- **Making sure your edits survive autosave.** The live session holds the notes, and autosave writes from it. So About this chat edits the notes in the live session store, never the saved file. Autosave used to fire when the *number* of notes changed, and an edit doesn't change the number, so it now fires whenever the notes list changes. A coach turn that finishes while you are editing adds its note on top of your change rather than overwriting it.
- **Editing a note keeps its seen/unconfirmed mark.** You fixed the wording, which doesn't say where the information came from. Editing a fact also leaves its mark alone; **Confirm** is the separate action for that. If you would rather an edit counted as confirmation, it is a one-line change in `memory-edit.ts`.
- **On facts, the mark reads "Seen or confirmed"** rather than "Seen on screen", because a fact you confirmed by hand was not necessarily seen on screen. Notes say "Seen on screen".
- **The coach is not shown the seen/unconfirmed mark on its own notes.** The brief asked for the label on facts only. Showing it on notes would change how the coach treats its own notes, which this job was told to leave alone.
- **Deleting from About this chat** clears the live session before deleting the file, so no autosave can write the chat back afterwards.
- **"Mark done"** puts the chat in the same resting state as when the coach itself says the goal is done. Typing anything wakes it up again, as before.

## Left alone, and why

- The rules in `coach.ts`, `stance.ts` and `check.ts`, as instructed.
- How the coach decides *what* to remember. Only storing, showing and correcting changed.
- The tidy-up call (step 9) and searching (step 8, job 3).
- **Renaming a chat** isn't on this screen. The brief didn't list it.

## Tests

| | Test files | Tests |
| --- | --- | --- |
| Before (trim branch) | 29 | 355 |
| After | 31 | 397 |

`npm run lint` and `npm run build` pass at each commit; `npm test` passes at each commit too.

New or changed tests:
- `chatNotes.test.ts` (new): the cap and retirement, retired notes not counted, forgotten and cap-retired notes not coming back, editing and forgetting, reading the new shape exactly, loose values never read as seen.
- `chatRecord.test.ts`: reading an old-shape chat (plain-string notes), saving it back in the new shape, a junk notes field, a restored chat keeping note ids, flags and retired notes, and a forgotten or edited note surviving the next save even after the coach writes again.
- `memoryRank.test.ts`: the boost, its size, the unconfirmed label, old facts with no flag read as unconfirmed, the boost not lifting irrelevant or stale facts, a check across kinds, ages and topics that the boost never drops a fact that was recalled before (`MIN_SCORE` still lets through at least what it did), and that a forgotten fact is never recalled.
- `memoryEdit.test.ts` (new): the pure part of `memory:update`.
- `coach.test.ts`: exact field-list pins for `say` and `wait`, and the new flags on both.
- `agentPrompts.test.ts`: the two flags parse only from an exact `true`, and the prompt sentences are present.

## Risks

- **Screens unseen.** The ⓘ button adds one more icon to the bottom bar. In the narrow docked sidebar that bar may now be crowded.
- **Cache re-write.** The first look after updating writes a new cached prefix because the field lists changed. After that the cache hit rate should return to normal. If it stays low, something else leaked into the prefix.
- **The coach may not use the flags well.** It may say "seen" too often or too rarely. That is down to the prompt sentence, which can be tuned once you have seen it live.
- **An edited note can be re-noted in its old wording.** If you correct a note, the coach could in principle write the original wording again as a new note, because it no longer matches anything. It is shown its notes every look and told not to repeat them, so this should be rare. Step 9's tidy-up is the natural place to catch it.
- **About this chat replaces the chat while open.** The composer is hidden until you press "Back to chat".

## Morning checklist

Run the app from this branch, or after merging it into the trim branch, then:

1. **Seen on screen.** Start a chat with something visible on screen, for example "help me with this spreadsheet" with Excel open. After a few looks, open ⓘ **About this chat**. A note about something the coach read on screen, such as the program or the file name, should say **Seen on screen**.
2. **Unconfirmed.** Type a preference, such as "I prefer keyboard shortcuts". Open Settings → **Review what it remembers**. The new fact should say **Not yet confirmed**. If it went into the chat's notes instead, it shows there as Not yet confirmed.
3. **Edit.** In About this chat, edit a note and save. Go back to chats and reopen the chat: the edit should still be there. In Settings, edit a fact, close and reopen the list, and check it kept the new wording. Press **Confirm** on an unconfirmed fact and check the mark changes.
4. **Forget.** Forget a fact in Settings. Start a new chat whose goal would have used it. In the activity log (`[memory] recalled …`), it should not be among the recalled facts, and the coach should not mention it. Forget a note in About this chat. It should disappear and not come back on later looks.
5. **Old chats.** Open a chat saved before this change. Its notes should appear, all marked Not yet confirmed.
6. **Delete.** Delete a throwaway chat from About this chat. It should ask first, then return you to the chat list without that chat.
7. **Cache.** In the log, check the cache hit rate recovers after the first look or two.

## Pull request

Opened against `claude/overnight-2026-11-09-trim`. If it could not be opened, the branch is pushed and the body is the "In plain words" and "What changed" sections above.
