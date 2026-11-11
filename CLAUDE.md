# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite (port 5173) + Electron, hot-reloads React side
npm run build     # Production Vite build + esbuild for Electron main/preload
npm run dist      # Full Windows NSIS installer → release/
npm run lint      # tsc --noEmit on both tsconfig.json (src/) and tsconfig.node.json (electron/)
```

```bash
npm test          # vitest — unit tests for the coach, chats, memory, the speech chunker, TTS helpers, timing guards
```

Runtime behavior (audio, capture, pacing feel) still needs a manual run to verify.

## What the app is

One coach, one input box, and a list of chats you can come back to. You give it a goal; it looks at the screen and decides how to help — a one-line answer, a step-by-step walkthrough, or setting a task and watching quietly. There are no modes to pick and no setup calls before it starts. For anything bigger than a quick answer, its first turn says the goal back and gets a yes before step one (see "Agreeing the goal"). **It coaches; it never acts** — there are deliberately no `click`/`type` tools, and keeping the agent read-only on the user's machine is the clearest safety line in the design.

`docs/ONE-COACH-PLAN.md` is the build plan this shape came from (its Progress section says what has and has not been run live). `docs/REDESIGN-BRIEF.md` describes the app for a separate visual redesign; the screens in `src/` are deliberately plain until that lands.

## Architecture: two processes, one IPC bridge

The app has a hard split between two TypeScript compilation targets:

**Electron main process** (`electron/`, compiled by esbuild → `dist-electron/`)
- `main.ts` — creates windows, registers all IPC handlers in `registerIpc()`, manages `glowWindow` and global input hook (`uiohook-napi`)
- `calibrate.ts` + `calibrate-detect.ts` — **screen calibration**: on some Windows machines `desktopCapturer.source.display_id` silently refers to the WRONG monitor (exact-looking ID match, wrong pixels). At startup (and on display changes / `capture:recalibrate`) a magenta marker window is flashed on each display and the capture source containing it is detected by pixel ratio (`calibrate-detect.ts` is pure and unit-tested). Everything that pairs sources↔displays (capture, the glow overlay via `resolveWatchedDisplayId()`, the screen picker) trusts this map first, IDs only as fallback. `captureFrame` awaits calibration, so markers never leak into captured frames. **Never trust display_id/ID matching for new features — go through the calibration map.**
- `claude.ts` — the Anthropic boundary. The per-look turn is delegated to the agent harness (`agents/harness/runner.ts`); what stays here is key resolution, tool dependency injection, the web-research call behind `search_web`, and `tidyChat()` — the one background call that is not an agent loop. The coach's model is the user's choice in Settings (`coachModel`: Sonnet 5.5 or Opus 5.5), passed in with each look; if the account rejects it the coach falls back to `FALLBACK_MODEL` for the rest of the run. `BACKGROUND_MODEL` is the small model for the tidy-up. **How a look is asked of each model lives in `agents/harness/models.ts`** — the models do not share a request surface
- `speech-chunker.ts` — pure module (no imports); incrementally extracts the `"instruction"` JSON string from the stream and splits it into sentences, holding back abbreviations/domains; unit-tested from `src/__tests__/speechChunker.test.ts`
- `dock.ts` + `dock-geometry.ts` — **docking**: the panel is a docked sidebar that reserves a strip of the watched monitor via the Windows AppBar API (`SHAppBarMessage` through `koffi` FFI) — the OS work area shrinks so maximized/snapped windows resize beside the coach. `dock-geometry.ts` is pure (unit-tested from `src/__tests__/dockGeometry.test.ts`); defaults are locked by `src/__tests__/dockSettings.test.ts`. Invariants: **never leave reserved space behind** (`ABM_REMOVE` fires on undock, window close, and `will-quit`; the OS reclaims it on crash), and **if koffi fails to load the app must fall back to floating** — docking can never make the app unusable. AppBar rects are physical pixels; convert only via `screen.dipToScreenRect`/`screenToDipRect`. `koffi`'s native binaries are `asarUnpack`ed in `package.json`.
- `capture.ts` — screenshot via Electron's `desktopCapturer`. **Capture exclusion rule:** while docked on the watched display, the sidebar's own strip is subtracted from every frame (dock strip first, then the user's `captureRegion` relative to the remainder) — the model never sees its own panel, and the glow overlay outlines only the remaining desktop
- `credentials.ts` — API keys encrypted with Electron's `safeStorage` (DPAPI on Windows) into `%APPDATA%/SightLine/keys.json`; `.env` values are copied in at startup. There is no key-entry screen yet
- `settings-store.ts` — settings persisted to `%APPDATA%/SightLine/settings.json`; read once and cached in memory (it is consulted on every global keystroke, capture, and TTS sentence), written atomically. `captureRegion` is **display-relative** — the glow window is offset by the dock strip while docked, so `main.ts` converts at commit time and `capture.ts` intersects with the dock remainder
- `types.ts` — **shared type definitions** used by both processes
- `tts/` — **the speech pipeline**. `tts/index.ts` is the only entry point: it owns the provider chain (ElevenLabs v4 Turbo → Google Chirp 3 → OpenAI → the renderer's system voice), per-provider timeouts, and the disk cache. The ElevenLabs model is `ELEVEN_MODEL` in `tts/shared.ts`, with the reasons and measured timings beside it; **it ignores a requested speed, so the Pace setting is applied at playback** (`playbackPace` in `useTts.ts`), and it takes only `stability` and `similarity_boost`. A different model may not accept the same request (v3 Conversational rejects `previous_text`) — check it live before switching. **Invariant: it never throws for a recoverable reason** — a missing key, dead voice, or hung request must degrade the voice, never stop the session. `tts/shared.ts` is pure (cache keys, the fixed phrase set, `preprocessForTts`) and is imported by BOTH processes — that shared `preprocessForTts` is load-bearing: the startup cache warmer and the live session must produce byte-identical strings or every cache key misses. `warmPhraseCache()` pre-synthesizes the fixed phrases at launch, so a thinking filler plays in ~0 ms.
- `usage.ts` — pure token accounting and cost estimation. Pricing table, cache-read/write multipliers, and `budgetStatus()`. The loop checks the budget **before** each call, so the cap is actually a cap. A web search inside a look and the tidy-up are counted too
- `db/schema.ts` — the data model, **types and Postgres DDL in one file** so they can't drift. `db/store.ts` implements it over JSON files; swapping it for Neon means writing a module with the same function signatures (see `docs/PRODUCTION.md`)
- **Chats and memory** — all pure, all unit-tested, all importable from the renderer:
  - `chat-record.ts` — live session ↔ saved chat, the step log, the where-we-left-off line, the id and shape checks
  - `chat-notes.ts` — a chat's notes: the cap, retiring, editing, reading older shapes
  - `chat-tidy.ts` — the checks that decide what the background tidy-up is allowed to write
  - `memory-rank.ts` — which remembered facts are worth the tokens, duplicate detection, and the caps. `MIN_SCORE` is calibrated against the score scale — set it too high and genuinely relevant memory gets silently dropped, which reads to the user as the coach having forgotten everything
  - `memory-edit.ts` — the rules for the user editing or confirming a fact
  - `memory-search.ts` — keyword search over facts and earlier chats, behind the `search_memory` tool
- `hotkey.ts` — pure push-to-talk key mapping plus `HoldDetector`, which collapses OS auto-repeat into single press/release edges.
- `agents/` — **the agent harness**. See "The coach" below. `harness/` is the machinery (schema assembly, context assembly, the tool loop); `skills/` are composable units of behaviour; `tools/` are what the model can do mid-turn; `coach.ts` is the one agent, a skill list plus two loop cadences. **Electron-free on purpose** — everything it needs from the OS arrives as injected `ToolDeps`, which is why the whole harness is unit-testable.

**React renderer** (`src/`, compiled by Vite → `dist/`)
- `store/session.ts` — Zustand store for the open chat; `reset()` spreads `...initial` so any new field added to `initial` is automatically reset. `loadChat()` restores a saved chat into it
- `store/settings.ts` — Zustand store that wraps IPC calls to load/patch settings
- `hooks/useSessionLoop.ts` — the main loop: capture → hash check → Claude → TTS → reschedule
- `hooks/useTts.ts` — module-level audio state (`currentAudio`, `speakGeneration`). Core primitive is `openSpeechStream()`: a per-response queue where sentences are enqueued as they stream in, cloud synthesis of chunk N+1 starts while chunk N plays, and playback is strictly ordered. Opening a new stream cancels the previous one; chunks within a stream are never cancelled mid-word. `speak(text)` is a one-shot stream (enqueue + end).
- `App.tsx` — the chat lifecycle: `startSession` (a new goal), `openChat` (reopen), `persistChat` + the autosave effect, `leaveChat`
- `components/Home.tsx` — the one front door: the goal box and the chat list. It is also the only place the background tidy-up is triggered
- `components/AboutChat.tsx` — what the coach remembers in this chat; edit, forget, mark done, delete
- `components/GoalCard.tsx` — the goal the coach said back, with the one-tap yes; shown in place of the current step while the goal waits on the user
- `components/ModelCaption.tsx` — which model the coach is on, one quiet line (under the message box in a chat, beside Start on Home). After a look it is the model that look ran on, which comes back with every answer (`InstructionResponse.model`), so a fallback shows as one; names come from `modelLabel()` in `agents/harness/models.ts`
- `lib/quickReplies.ts` — the words each one-tap button sends ("I did this", "Check my work", "I'm stuck", "Yes — start"), and `isQuickReply()`
- `lib/askClock.ts` — how long the user waited for the coach's first words (the `[timing]` log lines)

**The bridge** (`electron/preload.ts`)
- Exposes `window.sightline` via `contextBridge`
- `src/lib/api.ts` just re-exports the `SightLineApi` type and returns `window.sightline` — no logic lives there
- Adding a new IPC channel requires: handler in `registerIpc()`, method in `SightLineApi` interface, implementation in the `api` object (all in `preload.ts`)
- `agent:describe` carries the coach's loop cadences to the renderer. It must stay **plain data** — no skill objects, no tool functions; `describeAgent()` in `agents/registry.ts` is what flattens it
- Channel naming: `namespace:action` (e.g. `chats:save`, `claude:next-instruction`)
- **Anything from the renderer that becomes a file name or is written to disk is checked in the main process.** Chat ids go through `isChatId` (one helper in `db/store.ts` builds every chat path), and records through `isChatRecordShape`

## The loop (`useSessionLoop.ts`)

**The coach owns the cadence; the renderer owns the scheduler.** The coach declares two `LoopPolicy` cadences, one per stance (`Agent.loopByStance`); the renderer fetches them once over `agent:describe` (`src/lib/agentPolicy.ts`) and picks by the current stance. The split is deliberate — ticking needs the frame hash, the TTS queue, and the session store, all of which are renderer-side, so moving the loop into main would buy nothing and cost a lot. To change the pacing, edit `agents/coach.ts`.

**Stance** is how the coach is helping right now, and it is chat state: the coach sets it with the `stance` field on `say`/`wait`, the store keeps it, and it comes back in the context header every look.
- **guide** — walking the user through one step at a time. Looks often (15 s backstop, 30 s once the screen has been still > 2 min), reacts to input, checks in on a stall, and a finished step always gets the next one.
- **watch** — the user is doing the work themselves. Looks rarely (60 s / 120 s), ignores input, never checks in, and speaks only when asked. "Check my work" and "I'm stuck" are plain words (typed, spoken, or the one-tap replies shown while watching) — there are no bracketed markers.

The loop itself is a self-rescheduling `setTimeout` chain (not `setInterval`). The coach decides each look whether to speak (`say`) or stay silent (`wait`). **Looking more often is not the same as talking more often** — `wait` is the coach's most common turn by design, and speech is gated separately. Triggers and guards:
- **Backstop poll** — per stance, above
- **Input trigger** (guide only) — `uiohook-napi` global mouse/keyboard hook (750 ms debounce in main) → look after 1.5 s of input silence (`useQuietPeriod`), skipped while TTS is playing or the user is on the mic. This is the dominant term in "why did it take so long to react after I clicked something"
- **Follow-up trigger** — submitting a follow-up fires a look immediately in either stance and bypasses call spacing; a spoken thinking filler ("Let me take a look.") plays while Claude looks, with the answer queued behind it. A one-tap reply (`isQuickReply`) told the coach something rather than asking it, so it gets a plain acknowledgement ("Got it, one sec.") from its own set instead. **A filler plays before the coach knows what was said, so none may presume it** — "Good question" on a Done press was the first live run's first complaint. Fillers are pre-cached on disk, so they start in ~0 ms
- **A new chat or a new stance wakes a sleeping chain** — the sleep in progress was chosen for the old one. And a chain that was mid-look when the chat changed goes straight round instead of sleeping first
- **Guards** — `inFlightRef` (no concurrent calls — and a turn may span several tool round trips, so this matters; claimed before the first `await`), minimum spacing between calls (3 s guide, 10 s watch), `goalPending` (the coach has said the goal back; no look until the user answers, except their answer itself or a reopen greeting), `rateLimitUntil` (API backoff), the budget (`electron/usage.ts`, checked before the call; it applies per sitting — each time a chat is opened — while the saved chat keeps the running total), and `listening`/`transcribing` (never look while the user is speaking). External callers invoking `tickRef.current()` inherit all of these
- **Stale results are discarded** — the look records the chat id before calling Claude and applies the result only if the chat is unchanged and still `thinking`. Pause, leaving the chat, and delete can all land mid-call. A follow-up submitted mid-call is answered by the very next chain iteration, and the in-flight turn's speech is withheld rather than spoken over it
- **Stall ladder** (guide only) — when the screen has been still longer than the current step should take (`expected_pace`-scaled), a look proceeds without a screen change so Claude can check in (at most once per minute). A `diverted` (digression) state only suppresses this for `DIVERTED_STALL_MS` (2 min) — a false digression call must never silence the app forever. A digression never replaces the plan
- **Guaranteed first words** — the first look of a new chat passes `sessionJustStarted`; the prompt forbids `wait` and `digression` on that turn. Those first words are the answer to a quick question, or the goal said back for anything bigger. The first look after a chat is **reopened** passes `resuming`, and the coach greets the user with where things stood. A greeting whose look failed is handed back for the next look; one answered with silence is recovered into speech

The coach's cadences and rules are locked by `src/__tests__/coach.test.ts`; the loop executor's own guards by `src/__tests__/sessionLoop.timing.test.ts`. Changing either means updating the test deliberately.

**Diagnostics:** every look decision (skip reason, screen-change distance, Claude action + latency, stance, TTS events) is appended to `%APPDATA%/sightline/logs/sightline.log` via `electron/log.ts`; renderer logs route through the `session:log` IPC. "Why did it go quiet?" is answered by grepping `[loop]` lines there — do not remove these logs. `[timing]` lines record the wait from a goal or follow-up to the coach's first words. Screen-change detection lives in `src/lib/frameHash.ts` (16×16 luminance-cell signature; "changed" = >2 cells moving >8 luma) and the tick gate in `src/lib/loopGate.ts` — both unit-tested. Keep them sensitive: the historical failure mode was the app going silent because small UI changes (clicked tabs/buttons) hashed as "same screen".

## The coach

One agent (`agents/coach.ts`): a **skill list plus two loop cadences**; everything else is assembled from that.

**Composition.** A `Skill` (`agents/harness/types.ts`) has optional slots: a prompt fragment, tools, per-turn context blocks, and output fields on the terminal tools. The system prompt, the tool list, the terminal-tool schemas, and the context header are all *derived* from the skill array (`harness/schema.ts`, `harness/context.ts`) — there is no second place to update when a skill changes. In prompt order: `speech` (voice rules), `stance` (guide vs watch, say vs wait), `goal` (say the goal back and get a yes before the first step), `check` (what done looks like: verified each look while guiding, on request while watching), `troubleshoot`, `research`, `screenReading`, `pastChats`, `plan`, `stages` (a long goal's stages), `pointing`, `notes`, `memory`. **The two stances' rules contradict each other, so every rule says which stance it belongs to** — a rule written for guiding with no qualifier will be followed while watching too.

**How it talks.** Plain, like a friend at the next desk: the step itself first, no praise on every step, no stock openers, no recap of what just happened on screen, no remarks about the user's machine, no jokes. The coach copies any example it is given — the old rules offered "Nice, that's in. Now click…" and a list of openers, and the first live run got "Nice, …" on seven steps running — so **an example phrase in the prompt is a phrase the user will hear constantly**. There is no canned line after `done`; the coach's own wrap-up is the ending. The only fixed phrases left are the fillers, acknowledgements, lookup lines and the no-answer fallback in `tts/shared.ts`.

**The turn is a tool call.** The model ends every turn by calling `say` or `wait`; `harness/runner.ts` runs a bounded loop around that (`Agent.maxToolIterations`), executing any mid-turn tool and going again. The text-only history it sends (`historyMessages`) always opens on a user turn — the API rejects a leading assistant message. A `max_tokens` stop keeps the previous step lists and drops the note and the fact (a truncated tool input arrives as a partial object, not an error), and a response with no tool call ends silently rather than speaking raw text. **A finished step is never answered with silence while guiding:** a `wait` whose `completed_steps` grew is handed back once as a tool result asking for speech. While watching, a step recorded in silence is the point, so the bounce is skipped. Two consequences worth knowing:

- **Speech still streams.** Anthropic streams tool inputs as `input_json_delta`, so `speech-chunker.ts` reads the `say` call's partial JSON. TTS starts on the first finished sentence, mid-generation.
- **Silence is structural, not prompted.** `wait` is its own tool, and the tool NAME arrives in `content_block_start` before any input streams — so a silent turn is known silent with nothing buffered and nothing to retract. `disable_parallel_tool_use` allows at most one tool per response.
- **The 5.5 models do not guarantee a tool call.** Sonnet 5.5 and Opus 5.5 reject a forced tool choice (`tool_choice: any`), so the request can only ask (`auto`). A reply that calls no tool is asked once more in the same look; if it still calls none, the look ends in silence — raw text is never spoken. Their thinking cannot be switched off the old way (Sonnet 5.5 uses `between_tools`; Opus 5.5 always thinks and effort is the only dial), and it is tied to the exact request it came from: **the tool list must not change in the middle of a look**, and the model's own blocks go back exactly as they arrived. On those models the runner states limits in tool results instead of narrowing the list. The fallback model (Sonnet 5) still takes a forced tool choice and has its list narrowed as before. `src/__tests__/modelProfiles.test.ts` locks all of this; read the Claude API migration guide for a model before adding it to `models.ts`.

**Tools** (`agents/tools/`): `search_web` (findings mid-turn instead of costing a whole extra look), `read_screen_region` (re-captures cropped at near-native resolution — the payload frame is downscaled to 1280px, so small error text is often unreadable without it), and `search_memory` (earlier chats and saved facts; local, no model call).

**Agreeing the goal.** Anything bigger than a quick answer opens with `say` + `action: "confirm_goal"`: the coach says the goal back as one outcome plus what done looks like (`goal`, `done_when`), puts its route in `upcoming_steps`, and asks if that's right. It is the ordinary first look, so there is still no setup call. The renderer keeps `agreedGoal` / `doneWhen` / `goalPending` in the store (saved with the chat), shows `GoalCard`, and **holds every look until the user answers**. The coach's own next action settles it — another `confirm_goal` means the user corrected it, any other spoken turn means it took their reply as a yes — so the app never guesses at the user's words. The agreed goal replaces the user's raw words at the top of the panel and comes back in the context header every look; the raw words stay as `goal`. A quick question skips all of this. The goal fields are read only from a `confirm_goal` turn, so a stray value cannot rewrite what was agreed.

**Plans.** `completed_steps` / `upcoming_steps` are the coach's own lists. A turn that leaves `upcoming_steps` out keeps the plan; only an explicit list replaces it. A long goal also has **stages** (`stages`, `stage`): the coach lays out the titles once and writes the steps for a stage only when the user reaches it — there is no separate planning call.

**Prompt caching is the main hazard.** Render order is `tools` → `system` → `messages`, so **tool definitions sit ahead of the cached system prompt** — adding, removing, or reordering a tool or an output field re-writes the cache. Keep `Agent.skills` a fixed literal; never build it from runtime state. **Never put timestamps or per-look data in the prompt** (that belongs in the context header). There are two cached system blocks (`runner.ts → systemBlocks`): the coach's prompt, byte-identical on every look of every chat, and — only when the user attached files — the reference material, which is large and unchanging and used to be re-sent in full every look. The cache hit rate is logged every look; a collapse toward zero means something leaked into the prefix.

Screenshots are JPEG (quality 82, max 1280 px wide — `capture.ts`), never written to disk. The store keeps a rolling buffer of the last 5 frames in memory; the runner sends the last 2 — and only 1 when the screen hasn't changed. Only the latest frame goes at full resolution; the earlier one is re-encoded at 640 px by `toContextResolution()` because its only job is to show what changed. Cost per look is locked by `src/__tests__/usage.test.ts`.

## Chats

Every goal is a chat (`ChatRecord` in `db/schema.ts`). It is saved after every turn, listed on Home, and reopenable with its conversation, agreed goal, plan, stages, notes and stance intact. Leaving a chat saves it; nothing is cleared.

- **The step log** is the user's audit trail: every finished step, with the time it was done and the stage it belonged to. It is **append-only** — the coach reports its full list each turn, only entries beyond the end of the log are new, and nothing already logged is reworded or removed. The coach is shown the log's own wording on the next look, so the two cannot drift.
- **Where we left off** is rebuilt on every save with no model call, so it is right even after a crash. The background tidy-up writes a better one, which is used until the chat moves on.
- **The tidy-up** (`chat-tidy.ts`, `claude.ts → tidyChat`) runs from Home for chats that have moved on since they were last tidied: one small call proposes a title, a summary, note merges and durable facts. **The model only proposes** — fixed checks decide what is written, a note the user edited is never touched, a forgotten note or fact cannot come back, and a chat that changed while the call ran discards the result. Never tidy the open chat.

## Memory

Three layers, following `Garmin Insights App/docs/mvp2/adr/0009-memory-architecture.md`: keep what is injected every look small, and make the rest reachable on demand.

- **About you** — durable facts (`MemoryFact`: setup, preferences, past obstacles). The coach's `remember` field writes them; `memory-rank.ts` picks at most six against the goal, **once when a chat is opened**, so the text is stable across looks. Each is `verified` (the coach read it on screen, or the user confirmed it) or not, and unverified ones are labelled "unconfirmed" when shown to the coach.
- **This chat** — the coach's `notes`, each with a `seen` flag, capped at 30 live. Only live notes are shown to the coach.
- **Everything ever said** — not loaded; the coach searches it with `search_memory`.

**Forget means forget.** A forgotten fact is archived and a forgotten note is retired, and those entries are what stop the coach learning them again — so they are capped separately from live ones and never pruned to make room. A note the user corrected keeps its old wording, so that cannot come back either. The user can read, edit, confirm and forget everything (About this chat; the memory list in Settings).

## API keys

Keys are read at startup from `.env` in the project root (or `%APPDATA%/SightLine/.env`) and stored encrypted via `safeStorage` (`electron/credentials.ts`). See `.env.example` for the full list. `ANTHROPIC_API_KEY` is the only one that's required; `ELEVENLABS_API_KEY` is the highest-value optional one (the human-sounding, low-latency voice), `OPENAI_API_KEY` powers hold-to-talk transcription plus a TTS fallback, and Google Cloud TTS uses `GOOGLE_PROJECT_ID` / `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`. Missing voice keys degrade the voice, never break the session.

## Persistence

Chats and memory persist to JSON under `%APPDATA%/SightLine/data-v2` via `electron/db/store.ts` (`chats/<id>.json`, `chats-index.json`, `memory.json`). The older `data` folder, from before chats existed, is read once — to carry `memory.json` over — and never written. **Screenshots are never persisted**: they live in memory while a chat is open and nowhere else. That is a privacy property the first-run notice states plainly; do not add an exception. `electron/db/schema.ts` holds the types and the equivalent Postgres DDL together so they can't drift; moving to Neon means implementing the same function signatures against it. Every table already carries a nullable `user_id` for when auth lands. See `docs/PRODUCTION.md`.
