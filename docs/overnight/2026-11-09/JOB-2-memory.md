# Overnight job 2: memory you can see and correct (plan step 6)

Follow every rule in `docs/overnight/2026-11-09/README.md`.

**Branch:** start from `claude/overnight-2026-11-09-trim` if it exists on origin, otherwise from `one-coach`. Name yours `claude/overnight-2026-11-09-memory`. Open the pull request against the branch you started from, and say which it was. If the trim branch exists but its tests fail, start from `one-coach` and say so.

## Goal

The user can read what the coach remembers, correct it, forget it, and tell what the coach saw on screen from what it was told or assumed. The spec is `docs/ONE-COACH-PLAN.md`, step 6, and `docs/REDESIGN-BRIEF.md`, section 9.

## Build

**Notes become the chat's memory**
- Today a chat's notes are plain strings (`agentNotes` in `src/store/session.ts`, `notes` on `ChatRecord`). Give each note an id, its text, a `seen` flag, the time it was written, and a retired time. Update the type and the Postgres text in `electron/db/schema.ts` together.
- Chats saved before this change have notes as plain strings. Reading one must still work: convert on read, with `seen` false. Add a test with an old-shape record.
- At most 30 live notes per chat. When a new one would exceed that, retire the oldest. Retired notes stay in the record and are not shown to the coach.
- The coach still writes a note with the `notes` field. Add an optional boolean beside it that says the note records something the coach read on screen this turn. Adjust the wording in `electron/agents/skills/notes.ts` to say when to set it. Keep it to a sentence or two.

**Facts about the user**
- `remember` gains an optional `seen` boolean with the same meaning; `MemoryFact` gains `verified`. Facts already on disk have no such field: treat missing as false. Adjust `electron/agents/skills/memory.ts` by a sentence.
- `electron/memory-rank.ts`: a modest ranking boost for verified facts, and in the text handed to the coach, mark unverified ones as unconfirmed. Lock both with tests in `memoryRank.test.ts`. Check that `MIN_SCORE` still lets through what it did; `CLAUDE.md` explains why that threshold is delicate.
- New `memory:update` channel: change a fact's text, or mark it confirmed. Handler in `electron/main.ts`, method on the API in `electron/preload.ts`.

**Screens** (plain, in today's look; reuse existing styles and components)
- "About this chat", opened from the chat screen. Shows the goal, the where-we-left-off line, the live notes each marked "seen on screen" or "not yet confirmed", and attached file names. The user can edit a note's text, forget a note (retire it), mark the chat done, or delete the chat after a confirmation. It replaces the notes list currently tucked into the plan drawer's context panel.
- "About you": the memory list that lives in Settings today, with the same mark and with editing. Extending it where it is, is fine.
- A user's edit or forget must survive the next autosave. The live session holds the notes; make sure a save cannot write the old version back.

You cannot see these screens. Keep them simple, and say in the report that they are unseen.

## Leave alone

- The rules in `coach.ts`, `skills/stance.ts`, `skills/check.ts`.
- How the coach decides what to remember. This job is about storing, showing and correcting.
- The tidy-up call (step 9) and searching (step 8, job 3).

## Tests

The note cap and retirement; reading an old-shape chat; the ranking boost and the unconfirmed label; that a forgotten fact is never recalled; the pure part of the update handler; that a restored chat keeps note ids and flags. Changing the `say` and `wait` fields changes the coach's cached prefix: update the pins in `coach.test.ts` on purpose and mention it.

## Report

`docs/overnight/2026-11-09/JOB-2-REPORT.md`. Include the before and after of the coach's `say` and `wait` field lists, how old saved chats are handled, and a morning checklist the owner can follow in the app: have the coach learn something from the screen and see it marked as seen; tell it a preference and see it marked unconfirmed; edit one; forget one and confirm the next chat does not use it.
