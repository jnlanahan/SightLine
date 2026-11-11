# One coach: build plan

Branch: `one-coach` (nothing on `main` changes until you decide to merge).
What we are building: [REDESIGN-BRIEF.md](REDESIGN-BRIEF.md).
Date: 9 November 2026.

## In short

SightLine becomes one coach with one input box and a list of chats you can reopen. The work is twelve steps. Each step ends with something you can run and try for five minutes, and each is one commit on this branch, so any step can be undone on its own.

| # | Step | What you try when it's done |
| --- | --- | --- |
| 0 | Measure first | Run today's flow once so we have a speed number to beat |
| 1 | One box, straight to the coach | Type a goal; the coach starts talking after one AI call |
| 2 | One coach that knows when to stay quiet | A quick question, a walkthrough, and "just watch" all work from the same box |
| 3 | Chats save and reopen | Quit, relaunch, open the chat, carry on |
| 4 | Resume greeting | Reopen a chat and hear where you left off |
| 5 | Remove what's replaced | Same behaviour, much less app |
| 6 | Memory you can see | Read, correct and forget what the coach remembers |
| 7 | Long projects | A plan in stages that survives across sittings |
| 8 | Search the past | Ask about something from an old chat and get it |
| 9 | Tidy-up after you leave | Come back to a clean title, summary and notes |
| 10 | Try the current Claude models | Compare speed and quality against step 0 |
| 11 | Stop re-sending what doesn't change | Lower cost per look, same behaviour |
| 12 | Wrap up | Docs match the app; decide whether to merge |

## Progress

- **Built, 9 November 2026:** steps 0 to 4. Each is its own commit on `one-coach`. Tests, type-check and build pass. None of it has been run live yet, so pacing, voice and the on-screen flow are unconfirmed.
- **Baseline:** the step 0 commit is tagged `one-coach-baseline`. It still has the old setup flow, so one run of that build gives the "before" numbers. The `[timing]` lines land in the activity log.
- **Overnight, 9 to 10 November:** three cloud jobs built steps 5, 6 and 8, each on its own branch. Briefs and reports are in [overnight/2026-11-09](overnight/2026-11-09/README.md). A fourth job, a read-only review of steps 0 to 4, never ran: it started while the account was over its usage limit and was refused. No independent review has been done yet.
- **Merged, 10 November:** pull requests 6, 7 and 8 are merged into `one-coach`, at the owner's request, after the reports were read, the main integration points were checked, and tests (429), type-check and build passed on the combined result. The state before the merge (steps 0 to 4 only) is tagged `one-coach-steps-0-4`.
- **10 November, later:** steps 7 (stages), 9 (tidy-up) and 11 (caching attached files, counting search cost) are built. The independent review ran against steps 0 to 6 and 8; its report is [overnight/2026-11-09/REVIEW.md](overnight/2026-11-09/REVIEW.md). It found no way to lose a chat. Ten of its eleven findings are fixed; the one left (the step log detects new steps by list length) it judged unlikely. `CLAUDE.md` is rewritten to describe the app as it now is.
- **Step 10 done, 10 November, at the owner's request:** the coach runs on Sonnet 5.5 by default, with Opus 5.5 as a choice in Settings. The runner was changed to cope with what those models withdrew (see the step below). Checked against the live service: the real coach, with its real prompt and tools, produced a spoken first look on Sonnet 5.5, Opus 5.5 and the Sonnet 5 fallback, and the tidy-up's request works on Haiku 5.5.
- **Built so far:** every step. 506 tests, type-check and build pass. Steps 7, 9, 10 and 11 have not been reviewed by anyone else.
- **First live run, 10 November:** the owner ran one walkthrough on Sonnet 5.5 and it worked end to end. The findings are in the next section and are the work that remains.
- **Fixes from the first live run, 10 November, later:** all four are built, each its own commit: the "good question" filler, agreeing the goal, showing the model, and the voice (what it says, and a more natural voice model). What was decided is in "Fixes after the first live run" below. 536 tests, type-check and build pass. Agreeing the goal and the new wording were checked against the live service on Sonnet 5.5, and the new voice model against the owner's ElevenLabs account. **None of the four has been through a live run by the owner yet, and nobody has listened to the new voice.**
- **Next:** the owner's second test, then the results table, and merging `one-coach` into `main` or dropping it. Testing Opus 5.5 was put off by the owner; it is not blocking.

## First live run, 10 November 2026

The owner asked how to get the Windows score on their computer, on Sonnet 5.5 (the default; the log shows no fallback). One chat, 16 looks, 12 steps logged, 25 cents, cache hit rate 94%, no errors. Reopening a chat, the watch stance, stages, memory screens, search and the tidy-up were not exercised.

**What the owner said, and what to do about each:**

1. **"It keeps saying good question when I click done with a task."** Confirmed in the log. Every follow-up plays a random thinking filler before the answer (`useSessionLoop.ts`, `randomThinkingPhrase()`), one of which is "Good question — one sec." (`electron/tts/shared.ts`, `THINKING_PHRASES`). The "I did this — next step" button sends its press as a follow-up, so pressing it gets a filler meant for a question. Fix: a button press, and "check my work" / "I'm stuck", should play no filler or a short neutral acknowledgement from its own set. A filler phrase is part of the pre-cached set, so a new one has to be added there too.
2. **"The voice sounds so unnatural."** Not yet diagnosed, because it could be several different things. Ask which before changing anything: the voice itself (ElevenLabs, voice set in Settings); choppiness between sentences (each sentence is synthesized on its own, `electron/tts/elevenlabs.ts`); the pace; or the coach's wording ("Easy one.", "Nailed it, you're all set."), which comes from `agents/skills/speech.ts` and the fixed phrases. The filler in item 1 is probably part of it.
3. **"The agent needs to align on a goal before it starts… The user needs to know the goal and then start the session."** In the run the coach never said what the goal was or what done would look like; it gave step one and kept going for 12 steps. Proposed fix, with no extra AI call: the coach's first reply states the goal as one clear outcome and what done looks like, with its short plan; the panel shows that goal at the top in place of the user's raw words; and the user confirms with one tap or one word (or corrects it) before the coach gives step one. This is a deliberate step back from "no setup at all": one confirmation, zero forms. A quick question with an obvious answer should probably skip the confirmation; decide that with the owner.
4. **"I'm not even sure what model I was just on."** Nothing on screen says. Show the model's name somewhere quiet (the header status line or About this chat), and log it on every look.

**What was good:** "The response time is pretty good." Measured in that run: first words 2.9 s after the goal was submitted (audible at 3.4 s), and 2.5 s after a follow-up (audible at 2.8 s), with screenshots attached.

**Also seen in the log:** once, the model replied without calling a tool; the runner asked again in the same look and got a proper answer about three seconds later. That is the recovery working as designed, at the cost of one slower reply. Worth watching how often it happens.

## Fixes after the first live run

Built 10 November 2026, in the order the owner asked for. The owner said to make the calls; these are the calls.

**1. "Good question" on a Done press.**
- A button press now gets a short, plain acknowledgement ("Okay, let me look.", "Got it, one sec.", "Alright, checking now.") instead of a filler meant for a question. The same goes for "Check my work", "I'm stuck" and the new "Yes, start", and for those same words typed or spoken.
- "Good question, one sec." is removed altogether, not just for buttons. A filler plays before the coach has read what was said, and plenty of typed messages are not questions either.
- Kept a spoken acknowledgement rather than silence, because the answer takes two to three seconds and silence after a tap reads as nothing having happened.

**2. Agreeing the goal.**
- For anything bigger than a quick answer, the coach's first turn says the goal back as one outcome, says what done will look like, and asks if that's right. Step one comes only after a yes.
- **A quick question skips it.** If the coach can answer fully in one reply, it just answers. Asking someone to confirm that they want the answer to their own question would be a step backwards.
- One tap ("Yes — start") or one word agrees. Typing or saying anything else is a correction, and the coach says the goal back again.
- The coach does not look at the screen again until the user answers, so it cannot run ahead.
- The agreed goal replaces the user's raw words at the top of the panel. It and "done when" are also in the opened plan and in About this chat, and are saved with the chat.
- No extra AI call. The first look is spent agreeing the goal instead of giving step one, so the first step now arrives one exchange later. That is the price of the agreement.
- Checked against the live service on Sonnet 5.5 with the real prompt: a walkthrough goal and a learning goal both got the goal said back, a quick question was just answered, "yes" got step one, and a correction got the goal said back again.

**3. Which model.**
- One quiet line, "Model: Sonnet 5.5", under the message box in a chat and beside Start on the home screen.
- Once the coach has looked, it shows the model that look really ran on. If the account cannot use the chosen model and the coach falls back, it says "Sonnet 5 (fallback)".
- Not in the header: docked, the header has no room for it.
- The model is written to the log on every look.

**4. The voice.** Asked first, as requested. The owner's answer: the voice itself, and what it says. Not the pace, and not choppiness between sentences.

*What it says.* The log of the first run showed why it sounded scripted, and every cause was in the coach's own instructions:
- Seven step lines opened with "Nice, …". The instructions gave that exact phrase as the example to follow, and asked for a short acknowledgement on every step. Now: go straight to the next step, an acknowledgement on about one step in four, never "Nice".
- It kept saying what had just happened on screen ("Settings is up", "you're in System"). Now told plainly not to, with those lines as the examples of what to avoid.
- It added remarks ("That's a seriously strong machine"). The instructions asked for "a dry observation, a small joke, light sarcasm". That is gone: warm but plain, and only what helps with the next thing.
- A list of stock openers ("Okay, go ahead and…", "Quick one —", "Easy part:") is gone. Start with the step itself.
- After the coach's own wrap-up the app added a canned line ("Nailed it, you're all set."). Removed; the coach's own words are the ending.
- Checked against the live service with real screenshots: the lines came out plain, with no "Nice" and no stock openers. A small sample, so the owner's ear is the real test.

*The voice itself.* The app was on ElevenLabs' fastest and cheapest model (Flash v2.5), with its expressiveness turned down in September to stop the tone wandering between sentences. It now uses ElevenLabs' current real-time model (v4 Turbo), same "Sarah" voice, at that model's normal settings.
- Checked on the owner's account through the app's own connection: it works, and it still accepts the "what was said before" hint that keeps a reply sounding like one person.
- **Cost of the change:** a sentence takes about 0.6 to 0.85 seconds to come back instead of about 0.3, so the first words of a reply are heard roughly 0.4 seconds later. The short fillers are stored and still start at once.
- **It very likely costs more ElevenLabs credit per sentence** (ElevenLabs prices Flash at half rate). The app's key cannot read the account's plan or balance, so this could not be checked. If the credit runs out, the app falls back to the next voice, as before.
- The new model ignores a requested speed, so the Pace slider in Settings now works by playing the audio faster or slower. It behaves the same as before from the owner's side.
- Nobody has heard it yet. This is a change made from the documentation and from timings, and the owner's next test decides whether it stays. Going back is one line (`ELEVEN_MODEL` in `electron/tts/shared.ts`). If the model is better but "Sarah" is still wrong, Settings has a voice list with a Preview button.

## Calls I made

1. **One coach, two stances.** It either *guides* (step by step, speaks when a step is done) or *watches* (silent until asked). The coach picks, and "just watch" or "talk me through it" switches it. Waiting is the default in both.
2. **No setup calls.** The coach's first look at the goal and the screen replaces the question form and the plan-building call. It asks a question only when the answer changes what it does. (Changed after the first live run: for anything bigger than a quick answer, that first look now says the goal back and waits for a yes. Still no setup call and no form.)
3. **A chat replaces both the session and the training plan.** Old history and training plans are not carried over. New data goes in a new folder; the old folder is left untouched, so switching back to `main` is clean. Your "about you" facts are copied across once.
4. **Memory comes before long projects** (steps 6 and 7), because memory is the focus. Long tasks already work after step 4 as a running step list with notes; step 7 adds stages.
5. **Nothing visual is ever saved.** The one stored screenshot per "Check my work" goes away with the training code.
6. **Plain working screens now, redesign later.** New screens on this branch use today's look. The redesign is applied when it comes back, as a separate job.
7. **No key-entry screen in this plan.** It belongs with the redesign. This plan only fixes the dead end: a missing key will say where the key goes.
8. **The "Keep session history" switch goes.** Chats are the product; deleting a chat is the control. The "Remember me" switch stays.
9. **The AI model stays as it is until step 10**, where it is changed only if the numbers say so.
10. **Every chat keeps a step log** (added 9 November at your request). It is a running, timestamped record of each step done, the same for every kind of chat, and it only ever grows. It is saved with the chat and shown as a scrolling list at the top. It arrives in step 3.

## How we will know it worked

- **Speed.** Step 0 records today's wait from submitting a goal to first spoken words. After step 1 that wait is one coach turn, with no setup calls. Both numbers go in the results table at the end of this file.
- **Quiet.** The log shows more silent looks than spoken ones overall, and no unprompted speech during ten minutes of practice in the watch stance.
- **Coming back.** After a full restart, a reopened chat has its conversation, steps and notes, and the greeting says correctly where you left off.
- **Step log.** Every finished step appears in the chat's log with the time it was done, and the log from an earlier sitting is still there after a restart.
- **Memory.** Remembered items are visible and editable, a forgotten item is never used again, and the coach can find something from an old chat.
- **Smaller.** Step 5 reports files and lines removed.
- **Safe.** `npm test` and `npm run lint` pass at the end of every step, and the logged cache hit rate does not collapse.

Sound, screen capture and pacing can only be judged in a real run, so every step ends with a short script for you to try.

---

# Detail for whoever builds this

Read `CLAUDE.md` first. It describes the app before this work; where the two disagree, this plan wins until step 12 rewrites it. File and line references below come from a full read-through on 9 November 2026 and should be re-checked before editing.

## Things that must stay true

- The coach is read-only on the user's machine. No click or type tools.
- `Agent.skills` is a fixed literal. Nothing per-look goes in the cached prefix (tools, then system prompt). Stance, timing and steps belong in the per-look context header.
- Speech streams from the `say` tool's partial input. `wait` is a separate tool, so silence is structural.
- A look may span several tool round trips. The in-flight guard and the stale-result discard in `useSessionLoop.ts` stay.
- Text-to-speech never throws for a recoverable reason. Docking never leaves reserved space behind. Screen pairing goes through the calibration map.
- The `[loop]` log lines stay.
- Types and the Postgres text in `electron/db/schema.ts` change together. There is no database migration to run; storage is JSON files.
- Commits go on `one-coach` only, one per step, and are not pushed unless asked.

## Step 0: Measure first

**Outcome.** A baseline for "goal submitted to first spoken words", and for a normal turn.

**Changes.**
- There is no single log line for time to first words today. Add `[timing]` lines: goal or follow-up submitted, first sentence handed to speech, audio actually started (`src/hooks/useTts.ts`, `src/hooks/useSessionLoop.ts`).
- While the old setup flow still exists, log how long the questions call and the plan call take. They log nothing on success today (`electron/claude.ts`).

**Check.** Unit test for the timing helper. Then one real Tech Support session through the old flow. Record machine time (calls, the fixed 2.5 s auto-start, the spoken overview) separately from time spent answering questions.

## Step 1: One box, straight to the coach

**Outcome.** A goal typed into one box starts the coach in a single call.

**Changes.**
- New small `src/components/Home.tsx`: goal box, talk button, and the screen picker when there are two or more screens.
- `src/App.tsx`: the no-mode and no-goal branches render Home. `startSession(goal)` is called with no clarifications and no plan steps, mode fixed to `tech_support` for now.
- `ModeSelect.tsx` and `GoalPrompt.tsx` are no longer rendered. Their files are deleted in step 5.
- The first look already carries `sessionJustStarted`, so the coach speaks step one.

**Check.** Update `muteConsistency.test.ts`, which reads `GoalPrompt.tsx` for the overview speech call. Live: type a goal, compare the first-words time with step 0.

**Risk.** The progress line is empty until the coach's first reply supplies upcoming steps. Acceptable.

## Step 2: One coach that knows when to stay quiet

**Outcome.** One agent handles a quick answer, a walkthrough and silent watching, and chooses between them.

**Changes.**
- New `electron/agents/coach.ts`, registered as a fourth mode value, `coach`, which is the only one the app uses. The three old agents and their tests are left untouched and deleted in step 5, along with the `mode` plumbing. (Changed while building: adding the coach beside the old agents kept this step additive, instead of rewriting their tests here and deleting them later.)
- **Stance.** An optional `stance: "guide" | "watch"` field on `say` and `wait`, owned by a rewritten pacing skill, kept in the session store and shown to the coach in the context header each look.
- **Merged rules.** The two coaches contradict each other today, so each rule becomes stance-aware in one place:
  - *When to speak.* Guide: the step is visibly done, the user is stuck, they are heading wrong, or they asked. Watch: only when asked, at the start to set the task, or when the goal is reached. Never correct unprompted while watching.
  - *Judging completion.* Every step or task carries `expected_result`, what done looks like on screen. Guide checks it every look. Watch checks it when the user says "check my work", says what is right and what is missing, and completes the step only if it is visibly met.
  - *Stuck.* Guide gives the next concrete step. Watch gives the smallest useful hint.
  - *First look.* Decide the shape: answer directly, or give step one with a short plan, or for a learning goal set the first task and switch to watch. Ask at most two questions, and only if the answer changes what happens. Never silent on the first look.
  - *Per-look prompt.* One neutral closing line, so a follow-up is never followed by "a scan is never a reason to speak".
- **Runner.** The bounce that turns a silent "step finished" into speech (`harness/runner.ts`, around lines 413 to 437) applies only in the guide stance. It is an agent-wide switch today.
- **Loop.** `agent:describe` returns two timing presets with today's numbers: guide is 3 s spacing, 15 s and 30 s polls, 1.5 s input trigger, stall check-ins on; watch is 10 s spacing, 60 s and 120 s polls, no input trigger, no stall check-ins. `src/lib/agentPolicy.ts` and `useSessionLoop.ts` pick by the current stance.
- **Plan fields.** One meaning for `completed_steps` and `upcoming_steps`. The three plan tools, `task_verdict`, `mistake_pattern` and the bracketed `[check-my-work]` and `[stuck]` markers go. "Check my work" and "I'm stuck" are sent as plain text.
- **Bug fixed here.** A reply that leaves out `upcoming_steps` wipes the plan today (`harness/parse-turn.ts`, lines 29 to 31 and 82). Omission keeps the previous list, as it already does for completed steps.
- **Tools.** `say`, `wait`, `search_web`, `read_screen_region`. Tool round trips capped at three.
- **Screen.** The mode label goes. In watch, two one-tap replies ("Check my work", "I'm stuck") appear above the composer. In guide, the existing "I did this, next step" button stays.

**Check.**
- New `coach.test.ts` pins the coach: skill and tool order, the two presets, the rules that separate the stances, stance parsing, preset selection by stance, and that an omitted `upcoming_steps` keeps the plan. `agentRunner.test.ts` gains the bounce cases (guide bounces, watch does not).
- The old per-mode tests keep passing against the old agents until step 5 removes both.
- Live: a quick question gets a short answer then quiet; a walkthrough advances when a step is done; "just watch" goes silent; "check my work" gets feedback; "talk me through it" resumes guiding. Confirm the cache hit rate in the log is unchanged.

**Risk.** This is the step most likely to need tuning. Stance is logged on every look, so talking too much or too little can be traced to a rule and adjusted.

## Step 3: Chats save and reopen

**Outcome.** Every goal is a chat in a list. Reopening restores it, including after a restart.

**Changes.**
- `electron/db/schema.ts`: `ChatRecord` and `ChatSummary`, with the Postgres text updated alongside. A chat holds id, title, goal, state (`active` or `done`), created and last-active times, stance, steps (completed, current, upcoming), `whereWeLeftOff`, notes, turns including code blocks, attached files with their text, and running cost totals.
- `electron/db/store.ts`: `data-v2/chats/<id>.json` and `data-v2/chats-index.json`, written atomically. `memory.json` is copied into `data-v2` once. The old `data` folder is never read or written.
- `electron/main.ts` and `electron/preload.ts`: `chats:list`, `chats:get`, `chats:save`, `chats:delete`.
- New pure `src/lib/chatRecord.ts` replaces `sessionRecord.ts`. It keeps code blocks, which the old record dropped.
- **Step log.** The chat stores finished steps as `{ text, at }` entries. A pure helper appends an entry, stamped with the time, whenever the coach's completed list grows. The log is append-only: if the coach later rewords or shortens its list, logged entries stay as they were. The old record stamped every step with the session's end time, so real times are new.
- The progress line at the top opens the log as a scrolling list: finished steps with their times, grouped by day, then the current step and what is coming.
- Home lists recent chats: title (the first words of the goal until step 9 writes a better one), where it was left, when, and done or not.
- Opening a chat fills the session store from the record, recalls "about you" memory, and starts the loop.
- "Back to chats" replaces Stop. Leaving or quitting saves the chat and writes a mechanical where-we-left-off line from the last steps. No AI call.
- Deleting a chat asks first.

**Check.** Tests for the record builder, the record-to-store mapping, the where-we-left-off builder, and the step log (appends with a time, never rewrites). Live: start a chat, do two steps, quit, relaunch, reopen, continue, and see both steps in the log with their times.

## Step 4: Resume greeting

**Outcome.** A reopened chat begins with the coach saying where you were.

**Changes.**
- The first look after reopening carries `resuming` and how long the user was away (`harness/types.ts`, `harness/context.ts`, `electron/claude.ts`, `useSessionLoop.ts`).
- New guidance in `coach.ts`: look at the screen, say in one or two sentences where things stood and what is visible now, offer to pick up, do not repeat finished steps, do not stay silent. If the screen shows the user has moved on, ask.
- The chat's where-we-left-off line and notes are in the context header.

**Check.** Tests that the header carries the resume guidance and the saved line only on that first look. Live: reopen yesterday's chat.

## Step 5: Remove what's replaced

**Outcome.** The same behaviour with far less code. Approval of this plan covers the list below; anything not on it is asked about first.

**Whole features.**
- Teacher: `agents/teacher.ts`, `skills/socratic.ts`, the deferred research skill, the `research:search` channel with its DuckDuckGo fallback, `runWebResearch`, the `researching` status and its loop branch.
- The old coaches: `agents/tech-support.ts`, `agents/training.ts`, `skills/observe.ts`, `skills/review.ts`, `tools/plan.ts`, and the `mode` value everywhere it is passed.
- Setup calls and their channels: `getClarifications`, `getSessionPlan`, `getCurriculumOutline`, `detailTrainingModule`, `getGoalEvaluation`.
- Training: `electron/training-plan.ts`, `src/lib/trainingProgress.ts`, `CurriculumOutline.tsx`, the `plans:*` channels, plan storage and the saved screenshots.
- Screens: `ModeSelect.tsx`, `GoalPrompt.tsx`, the "Done" button with its verdict card, the stop banner.
- History: the `history:*` channels, the session record types, the `historyEnabled` setting.

**Dead or duplicated.**
- The "Check frequency" setting, which nothing reads.
- Store fields `pauseReason` and `lastTtsEngine`; the `clarifying` and `evaluating` statuses.
- Unused pieces of `design/primitives.tsx` and `design/icons.tsx`.
- Unused channels `window:open-external` and `dock:set`; the stale `IpcChannel` type.
- The second mute button and the second attach button.
- `useVoice.ts`: Home uses the same hold-to-talk as the composer.
- The `@types/jsdom` dev dependency.

**Wording.**
- Privacy notice: keys are stored encrypted on this PC, not in Windows Credential Manager. "Screenshots are never saved" becomes true.
- A missing key says which file to put it in. Remove "add one above" hints that point at nothing.
- "Dock to the side" loses "during sessions". The Settings section titled "Window" that only holds the voice switch is renamed.

**Check.** `npm test`, `npm run lint`, `npm run build`. Delete `trainingPlan.test.ts` and the teacher and curriculum cases. Live smoke test: a quick chat and a reopen. Report lines and files removed.

## Step 6: Memory you can see

**Outcome.** The user can read, correct and forget what the coach remembers, and can tell what it saw from what it assumed.

**Changes.**
- The coach's in-chat notes become the chat's memory. Each note has text, a `seen` flag and a retired time. Cap of 30 live notes; overflow retires the oldest until step 9 does better.
- `remember` gains `seen`: true only when the coach read the fact on screen. `MemoryFact` gains `verified`.
- `electron/memory-rank.ts`: a small ranking boost for verified facts, and unverified facts are labelled as unconfirmed in the prompt.
- New `memory:update` channel for editing a fact or marking it confirmed.
- "About this chat" panel: goal, where it was left, notes with their mark, edit and forget, attached files, mark done, delete.
- "About you" panel: the list now in Settings, with edit and the same mark.

**Check.** Tests for the ranking boost, the prompt label, and note cap and retirement. Live: a fact read from the screen appears as seen; a stated preference appears as unconfirmed; edit one; forget one and confirm the next chat does not use it.

## Step 7: Long projects

**Outcome.** A learning goal gets a plan in stages that carries across sittings.

**Changes.**
- A chat's plan gains stages. The coach lays out stage titles once, and writes the steps for a stage only when it becomes current. That replaces the separate module-detail call with no extra call.
- New optional fields for the stage list and the current stage. The coach still owns `upcoming_steps` for the current stage.
- Prompt: for a long goal, three to eight stages anchored on one concrete outcome, practised in the user's own program, early wins first; set the first task with its `expected_result`, then watch.
- The progress line shows stage and step. The plan drawer lists stages.

**Check.** Tests for stage advance, parsing, record round trip and progress. Live: "teach me pivot tables", practise, check work, quit, reopen the next day with the position intact.

## Step 8: Search the past

**Outcome.** The coach can look up earlier chats and facts when it needs them.

**Changes.**
- One new mid-look tool, `search_memory(query)`. It runs locally with no AI call, over facts that were not loaded, other chats' titles, goals, summaries and notes, and their transcripts. It returns the top five snippets with chat title and date.
- Scoring reuses the keyword helper in `memory-rank.ts`. The search function is injected through `ToolDeps`, so the agent code stays free of Electron.
- Prompt: use it when the user refers to something earlier or the problem looks familiar. Not on every look.
- Status text while it runs: "Checking earlier chats…".

**Check.** Tests for the search ranking and the tool wiring. Live: in a new chat, ask what was done about a problem from an old chat.

**Note.** Adding a tool changes the cached prefix once. That is expected.

## Step 9: Tidy-up after you leave

**Outcome.** Chats come back with a proper title, an accurate summary and clean notes.

**Changes.**
- Runs in the background when the user returns to Home, and at launch for chats left untidied by a quit. Never during an active chat, and one at a time.
- One non-streamed call. Input: the turns since the last tidy, the current notes and summary, and the "about you" list. Output: a title, a two-sentence where-we-left-off, note changes (keep, merge, retire), facts to add, and one line saying what changed.
- Fixed checks run before anything is written: length caps, ids must exist, duplicate facts rejected, nothing resembling a password or card number, and nothing the user edited by hand is altered. A failed tidy leaves the chat as it was.
- New facts are unconfirmed unless they come from a note marked seen.
- Its cost is added to the chat's total.
- "About this chat" shows the what-changed line.

**Check.** Thorough tests for the checks and for applying changes. Live: leave a messy chat and reopen it.

## Step 10: Try the current Claude models

**Outcome.** A decision, by measurement, on which model the coach and the background call use.

**Changes.**
- The app is pinned to `claude-sonnet-4-6` in `electron/claude.ts`. Make the model one constant per role: coach, and background.
- Compare `claude-sonnet-5-5` for the coach and `claude-haiku-5-5` for the tidy-up, on the same goals used in step 0.
- If the account rejects a model id, fall back to the current one.
- Update the price table in `electron/usage.ts` and drop its unused rows. Take model ids, prices and request options from the Claude API reference at build time, not from memory.

**Check.** First-words time, turn time, and cost per look from the log, plus the user's judgement of answer quality. Keep the faster model only if quality is at least as good.

**Status, 10 November: partly done, and the rest is a decision.**

Done: the model is one constant per role (`MODEL`, `BACKGROUND_MODEL` in `electron/claude.ts`); the tidy-up uses `claude-haiku-5-5` and falls back to the coach's model if the account rejects it; the price table has the current models.

Not done: the coach is still on `claude-sonnet-4-6`. Checking the Claude API reference showed that moving it is not a one-line change:

- **The newest models reject forced tool choice.** `claude-sonnet-5-5` and `claude-opus-5-5` return an error for `tool_choice: any`. The coach's whole turn is built on it: every look must end in exactly one of `say` or `wait`, which is what makes silence certain and lets speech start mid-reply. On those models the request has to use `auto` with the rule stated in the prompt, and the runner has to cope with a reply that calls no tool. The runner already ends such a reply silently, so it is workable, but "the coach said nothing" would become something the model can do by accident.
- **Thinking cannot be turned off on them.** That adds time before the first word unless effort is set low, and speed is the first priority here.
- **The smaller move is `claude-sonnet-5`.** Per the reference it still accepts forced tool choice, and it is cheaper than the current model ($2 and $10 per million tokens, against $3 and $15). Thinking is on by default there, so the request would turn it off explicitly to keep the current speed.

Recommendation: try `claude-sonnet-5` first, as a config change measured against the step 0 numbers. Treat the 5.5 models as a separate piece of work with its own live comparison. Read the migration guide for the target model before changing anything.

**Update, later on 10 November: the owner chose the 5.5 models, with a choice between them.**

- Settings has a Coach section: Sonnet 5.5 (default) or Opus 5.5. It takes effect on the next look.
- `electron/agents/harness/models.ts` holds how a look is asked of each model. Sonnet 5.5: thinking at its lowest setting (`between_tools`), medium effort. Opus 5.5: no thinking setting (it always thinks), low effort, a larger token allowance.
- The request asks for a tool call (`auto`) where it used to insist. A reply with no tool call is asked once more in the same look, then ends in silence. Raw text is never spoken.
- The tool list no longer changes mid-look on these models; the limit on lookups is stated in the tool result.
- A safety decline is retried by the service on another model inside the same call.
- If the account rejects the chosen model, the coach falls back to Sonnet 5 for the rest of the run and logs it. The mid-look web search always runs on Sonnet 5.

Live samples, first look, no screenshot attached, so real looks will be slower:

| Model | To first words | Whole reply |
| --- | --- | --- |
| Sonnet 5.5 | 2.1 to 3.3 s | 3.0 to 4.7 s |
| Opus 5.5 | 1.6 s | 2.9 s |
| Sonnet 5 | 1.0 s | 2.3 s |

Sonnet 5.5 is from six looks; the other two are one look each, so treat them as a rough guide only. In these samples the older Sonnet 5 was the quickest to its first word. Low effort on Sonnet 5.5 was no faster than medium.

## Step 11: Stop re-sending what doesn't change

**Outcome.** Lower cost per look, and shorter turns when files are attached.

**Changes.**
- Today only the system prompt is cached. The goal, attached files (up to 200,000 characters each) and recalled memory are re-sent in full on every look.
- Move what is stable for a sitting (goal, attached files, "about you" recall, stage list) into a second cached block. Timing, the previous instruction, steps, notes, stance and guidance stay in the per-look header.
- Memory recall is awaited before the first look so the block never changes mid-sitting. Today it can arrive after the first look.
- Count the AI call inside `search_web` in the cost. It is invisible to the meter and the spending cap today.
- Confirm cache block rules against the Claude API reference when building.

**Check.** Extend the cache-stability tests in `agentHarness.test.ts` to cover the second block. Update the cost ceilings in `usage.test.ts` deliberately. Live: the per-look cache-read figure in the log rises.

## Step 12: Wrap up

- Rewrite the Agents, Session loop and Persistence sections of `CLAUDE.md`.
- Correct `docs/PRODUCTION.md`, `.env.example` and the README where they describe removed features or the wrong key storage.
- Fill in the results table below.
- Decide: merge `one-coach` into `main`, or drop it.

## Not in this plan

- Applying the redesign. It starts when the design comes back.
- A key-entry screen. It is in the design brief.
- Sign-in, cloud storage, payments, monitoring.

## Results

| Measure | Before (step 0) | After step 1 | After step 10 |
| --- | --- | --- | --- |
| Goal submitted to first spoken words, machine time | not measured | not measured | 2.9 s (heard at 3.4 s) |
| Follow-up asked to first spoken words | not measured | not measured | 2.5 s (heard at 2.8 s) |
| Typical turn time | | | |
| Cost per look | not measured | not measured | about 1.6 cents (25 cents over 16 looks) |
| Lines of source, excluding tests | | | |

The last column is one live run on Sonnet 5.5, 10 November 2026: one sample of each. The "before" numbers were never taken; the build that still has the old setup flow is tagged `one-coach-baseline` if they are wanted.
