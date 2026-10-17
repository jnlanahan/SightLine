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
npm test          # vitest — unit tests for the speech chunker, TTS helpers, timing guards
```

Runtime behavior (audio, capture, pacing feel) still needs a manual run to verify.

## Architecture: two processes, one IPC bridge

The app has a hard split between two TypeScript compilation targets:

**Electron main process** (`electron/`, compiled by esbuild → `dist-electron/`)
- `main.ts` — creates windows, registers all IPC handlers in `registerIpc()`, manages `glowWindow` and global input hook (`uiohook-napi`)
- `calibrate.ts` + `calibrate-detect.ts` — **screen calibration**: on some Windows machines `desktopCapturer.source.display_id` silently refers to the WRONG monitor (exact-looking ID match, wrong pixels). At startup (and on display changes / `capture:recalibrate`) a magenta marker window is flashed on each display and the capture source containing it is detected by pixel ratio (`calibrate-detect.ts` is pure and unit-tested). Everything that pairs sources↔displays (capture, the glow overlay via `resolveWatchedDisplayId()`, the screen picker) trusts this map first, IDs only as fallback. `captureFrame` awaits calibration, so markers never leak into captured frames. **Never trust display_id/ID matching for new features — go through the calibration map.**
- `claude.ts` — the Anthropic boundary. The per-tick turn is delegated to the agent harness (`agents/harness/runner.ts`); what stays here is key resolution, tool dependency injection, and the pre-session calls that are not agent loops (clarifications, session plan, goal evaluation, and training's `getCurriculumOutline` / `detailTrainingModule`)
- `speech-chunker.ts` — pure module (no imports); incrementally extracts the `"instruction"` JSON string from the stream and splits it into sentences, holding back abbreviations/domains; unit-tested from `src/__tests__/speechChunker.test.ts`
- `dock.ts` + `dock-geometry.ts` — **Coach Mode docking**: during sessions the panel becomes a docked sidebar that reserves a strip of the watched monitor via the Windows AppBar API (`SHAppBarMessage` through `koffi` FFI) — the OS work area shrinks so maximized/snapped windows resize beside the coach. `dock-geometry.ts` is pure (unit-tested from `src/__tests__/dockGeometry.test.ts`); defaults are locked by `src/__tests__/dockSettings.test.ts`. Invariants: **never leave reserved space behind** (`ABM_REMOVE` fires on undock, window close, and `will-quit`; the OS reclaims it on crash), and **if koffi fails to load the app must fall back to floating** — docking can never make the app unusable. AppBar rects are physical pixels; convert only via `screen.dipToScreenRect`/`screenToDipRect`. `koffi`'s native binaries are `asarUnpack`ed in `package.json`.
- `capture.ts` — screenshot via Electron's `desktopCapturer`. **Capture exclusion rule:** while docked on the watched display, the sidebar's own strip is subtracted from every frame (dock strip first, then the user's `captureRegion` relative to the remainder) — the model never sees its own panel, and the glow overlay outlines only the remaining desktop
- `credentials.ts` — API keys encrypted with Electron's `safeStorage` (DPAPI on Windows) into `%APPDATA%/SightLine/keys.json`; `.env` values are copied in at startup
- `settings-store.ts` — settings persisted to `%APPDATA%/SightLine/settings.json`; read once and cached in memory (it is consulted on every global keystroke, capture, and TTS sentence), written atomically. `captureRegion` is **display-relative** — the glow window is offset by the dock strip while docked, so `main.ts` converts at commit time and `capture.ts` intersects with the dock remainder
- `types.ts` — **shared type definitions** used by both processes
- `tts/` — **the speech pipeline**. `tts/index.ts` is the only entry point: it owns the provider chain (ElevenLabs Flash → Google Chirp 3 → OpenAI → the renderer's system voice), per-provider timeouts, and the disk cache. **Invariant: it never throws for a recoverable reason** — a missing key, dead voice, or hung request must degrade the voice, never stop the session. `tts/shared.ts` is pure (cache keys, the fixed phrase set, `preprocessForTts`) and is imported by BOTH processes — that shared `preprocessForTts` is load-bearing: the startup cache warmer and the live session must produce byte-identical strings or every cache key misses. `warmPhraseCache()` pre-synthesizes the fixed phrases at launch, so a thinking filler plays in ~0 ms.
- `usage.ts` — pure token accounting and cost estimation. Pricing table, cache-read/write multipliers, and `budgetStatus()`. The loop checks the budget **before** each call, so the cap is actually a cap.
- `db/schema.ts` — the data model, **types and Postgres DDL in one file** so they can't drift. `db/store.ts` implements it over JSON files under `%APPDATA%/SightLine/data`; swapping it for Neon means writing a module with the same function signatures (see `docs/PRODUCTION.md`).
- `memory-rank.ts` — pure ranking for cross-session memory. Decides which remembered facts are worth the tokens. `MIN_SCORE` is calibrated against the score scale — set it too high and genuinely relevant memory gets silently dropped, which reads to the user as the coach having forgotten everything.
- `hotkey.ts` — pure push-to-talk key mapping plus `HoldDetector`, which collapses OS auto-repeat into single press/release edges.
- `agents/` — **the agent harness**. See "Agents" below. `harness/` is the machinery (schema assembly, context assembly, the tool loop); `skills/` are composable units of behaviour; `tools/` are what the model can do mid-turn; `tech-support.ts` / `training.ts` / `teacher.ts` are the three agents, each a skill list plus a loop policy. `registry.ts` is the only place modes are enumerated. **Electron-free on purpose** — everything it needs from the OS arrives as injected `ToolDeps`, which is why the whole harness is unit-testable.

**React renderer** (`src/`, compiled by Vite → `dist/`)
- `store/session.ts` — Zustand store for all session state; `reset()` spreads `...initial` so any new field added to `initial` is automatically reset
- `store/settings.ts` — Zustand store that wraps IPC calls to load/patch settings
- `hooks/useSessionLoop.ts` — the main session loop: capture → hash check → Claude → TTS → reschedule
- `hooks/useTts.ts` — module-level audio state (`currentAudio`, `speakGeneration`). Core primitive is `openSpeechStream()`: a per-response queue where sentences are enqueued as they stream in, cloud synthesis of chunk N+1 starts while chunk N plays, and playback is strictly ordered. Opening a new stream cancels the previous one; chunks within a stream are never cancelled mid-word. `speak(text)` is a one-shot stream (enqueue + end).

**The bridge** (`electron/preload.ts`)
- Exposes `window.sightline` via `contextBridge`
- `src/lib/api.ts` just re-exports the `SightLineApi` type and returns `window.sightline` — no logic lives there
- Adding a new IPC channel requires: handler in `registerIpc()`, method in `SightLineApi` interface, implementation in the `api` object (all in `preload.ts`)
- `agent:describe` carries the agent's loop policy to the renderer. It must stay **plain data** — no skill objects, no tool functions; `describeAgent()` in `agents/registry.ts` is what flattens it
- Channel naming: `namespace:action` (e.g. `overlay:show-glow`, `claude:next-instruction`)

## Session loop (`useSessionLoop.ts`)

**The agent owns the cadence; the renderer owns the scheduler.** Each agent declares a `LoopPolicy` (`Agent.loop`); the renderer fetches it once per session over `agent:describe` (`src/lib/agentPolicy.ts`) and executes it. The split is deliberate — ticking needs the frame hash, the TTS queue, and the session store, all of which are renderer-side, so moving the loop into main would buy nothing and cost a lot. To change a mode's pacing, edit its agent module; there is no per-mode switch in the loop any more.

The loop itself is a self-rescheduling `setTimeout` chain (not `setInterval`). The agent decides each tick whether to speak (`say`) or stay silent (`wait`). **Looking more often is not the same as talking more often** — `wait` is the agent's most common turn by design, and speech is gated separately — which is why the pacing below can be aggressive without the coach becoming interrupt-y. Triggers and guards (tech_support policy):
- **Backstop poll** — 15 s normally, 30 s once the screen has been still > 2 min
- **Input trigger** — `uiohook-napi` global mouse/keyboard hook (750 ms debounce in main) → tick after 1.5 s of input silence (`useQuietPeriod`), skipped while TTS is playing or the user is on the mic. This is the dominant term in "why did it take so long to react after I clicked something"
- **Follow-up trigger** — submitting a follow-up fires a tick immediately in every mode and bypasses call spacing; a spoken thinking filler ("Let me take a look.") plays while Claude looks, with the answer queued behind it. Fillers are pre-cached on disk, so they start in ~0 ms
- **Guards** — `inFlightRef` (no concurrent calls — and a turn may now span several tool round trips, so this matters more; claimed before the first `await`), 3 s minimum spacing between calls (`loop.minCallSpacingMs`), `rateLimitUntil` (API backoff), the session budget (`electron/usage.ts`, checked before the call), and `listening`/`transcribing` (never tick while the user is speaking). External callers invoking `tickRef.current()` inherit all of these
- **Stale results are discarded** — the tick records the `sessionId` before calling Claude and applies the result only if the session is unchanged and still `thinking`. Pause, Stop, and Done can all land mid-call; applying the result used to flip status back to `watching` and silently undo them. A follow-up submitted mid-call is answered by the very next chain iteration, and the in-flight turn's speech is withheld rather than spoken over it
- **Stall ladder** — when the screen has been still longer than the current step should take (`expected_pace`-scaled), a tick proceeds without a screen change so Claude can check in (at most once per minute). A `diverted` (digression) state only suppresses this for `DIVERTED_STALL_MS` (2 min) — a false digression call must never silence the app forever
- **Guaranteed first step** — the first tick after session start passes `sessionJustStarted`; the prompt forbids `wait` and `digression` on that turn, so the coach always speaks step 1 right after the plan overview

Per-agent timings are locked by `src/__tests__/agentHarness.test.ts`; the loop executor's own guards and hysteresis by `src/__tests__/sessionLoop.timing.test.ts`. Changing either means updating the test deliberately.

**Diagnostics:** every tick decision (skip reason, screen-change distance, Claude action + latency, TTS events) is appended to `%APPDATA%/sightline/logs/sightline.log` via `electron/log.ts`; renderer logs route through the `session:log` IPC. "Why did it go quiet?" is answered by grepping `[loop]` lines there — do not remove these logs. Screen-change detection lives in `src/lib/frameHash.ts` (16×16 luminance-cell signature; "changed" = >2 cells moving >8 luma) and the tick gate in `src/lib/loopGate.ts` — both unit-tested. Keep them sensitive: the historical failure mode was the app going silent because small UI changes (clicked tabs/buttons) hashed as "same screen".

## Agents

Three real agents, one harness (only two — tech support and training — are visible in the mode picker; teacher is dormant but intact). Each agent is a **skill list plus a loop policy**; everything else is assembled from that.

**Training mode is a multi-session curriculum coach.** It interviews the user (deeper intake via `Agent.maxClarifications`), generates a persisted `TrainingPlan` (modules → tasks with objectives and done-criteria; later modules are outlined up front and **detailed lazily** when they become current, informed by the plan's journal), then coaches across sessions. In-session: the 60 s scans are **silent by contract** and only build an activity log; speech is triggered by the "Check my work" / "I'm stuck" buttons, which travel through the ordinary follow-up path carrying the bracketed markers in `electron/types.ts` (`CHECK_MY_WORK_FOLLOW_UP` / `STUCK_FOLLOW_UP`). A spoken `task_verdict` (`review` skill, say-only field) advances the plan cursor via the pure helpers in `electron/training-plan.ts`; `src/lib/trainingProgress.ts` owns the renderer side (frame save, plan save, background module detailing). The plan's own memory — `whereWeLeftOff`, journal, `mistakePatterns` — rides the byte-stable `trainingContext` block, resolved from the plan record, not per tick.

**Composition.** A `Skill` (`agents/harness/types.ts`) has five optional slots: a prompt fragment, tools, per-turn context blocks, output fields on the terminal tools, and which of those it owns. Skills are shared by listing them twice — `speech`, `notes`, `memory`, and `plan` are on all three agents; `verify` / `troubleshoot` / `pointing` are tech-support only; `observe` and `review` are training's; `socratic` is teacher's. The system prompt, the tool list, the terminal-tool schemas, and the context header are all *derived* from the skill array (`harness/schema.ts`, `harness/context.ts`) — there is no second place to update when a skill moves.

**The turn is a tool call.** The model ends every turn by calling `say` or `wait`; `harness/runner.ts` runs a bounded loop around that (`Agent.maxToolIterations`), executing any mid-turn tool and going again. The text-only history it sends (`historyMessages`) always opens on a user turn — the API rejects a leading assistant message, and after ~10 spoken steps with no typed follow-up a naive tail slice is all-assistant. A `max_tokens` stop keeps the previous step lists (a truncated tool input arrives as a partial object, not an error), and a response with no tool call ends silently rather than speaking raw text. **A finished step is never answered with silence:** for agents with `speakOnStepComplete` (tech support), a `wait` whose `completed_steps` grew is handed back once as a tool result asking for speech — the user just did what was asked and is waiting, and the screen-change gate would otherwise keep the coach quiet until they moved. Training's silent activity log is exempt by design. Two consequences worth knowing:

- **Speech still streams.** Anthropic streams tool inputs as `input_json_delta`, so `speech-chunker.ts` reads the `say` call's partial JSON exactly as it read the old response text. TTS starts on the first finished sentence, mid-generation.
- **Silence is structural, not prompted.** `wait` is its own tool, and the tool NAME arrives in `content_block_start` before any input streams — so a silent turn is known silent with nothing buffered and nothing to retract. The old failure mode (a mode with no way to say "say nothing" reading its own JSON aloud) is now impossible rather than prompt-enforced. `disable_parallel_tool_use` forces exactly one tool per response, which is what makes "did the turn end?" a single check.

**Tools** (`agents/tools/`): `search_web` (findings mid-turn instead of costing a whole extra tick), `read_screen_region` (re-captures cropped at near-native resolution — the payload frame is downscaled to 1280px, so small error text is often unreadable without it), and `plan_add_step` / `plan_revise_step` / `plan_complete_step` (training only — atomic, diffable plan edits, and the seam richer plan tracking grows into). **There are deliberately no `click`/`type` tools:** SightLine coaches, it does not act, and keeping the agent read-only on the user's machine is the clearest safety line in the design.

**Prompt caching is the main hazard.** Render order is `tools` → `system` → `messages`, so **tool definitions sit ahead of the cached system prompt** — adding, removing, or reordering a tool re-writes the cache for the whole session. Keep `Agent.skills` a fixed literal; never build it from runtime state. Same rule as before for the prompt itself: **never put timestamps or per-tick data in it** (that belongs in the context header). The cache hit rate is logged every tick; a collapse toward zero means something leaked into the prefix. Locked by `src/__tests__/agentHarness.test.ts`, alongside `techSupportSkills.test.ts`, `claude.prompt.test.ts`, and `agentPrompts.test.ts`.

The out-of-band research path (`research:search` in main.ts → `runWebResearch()`, with a DuckDuckGo fallback) still exists and is what the teacher agent uses — it takes `deferredResearchSkill` rather than the live tool, because a resource recommendation is not worth making a learner sit through a round trip mid-sentence.

Screenshots are JPEG (quality 82, max 1280 px wide — `capture.ts`), never written to disk. The session keeps a rolling buffer of the last 5 frames in memory (`store/session.ts → pushFrame`); `claude.ts` sends the last 2 (`MAX_FRAMES`) — and only 1 when the screen hasn't changed, since the history frame would be a duplicate. Only the latest frame goes at full resolution; earlier frames are re-encoded at 640 px by `toContextResolution()` (~4x cheaper) because their only job is to show what changed. Cost per tick is locked by `src/__tests__/usage.test.ts`, which fails if the payload inflates.

**Cross-session memory:** the agent's `remember` output field records durable facts (setup, preferences, past obstacles); `memory-rank.ts` selects which to recall against the new goal, and the result is resolved **once at session start** so the prompt prefix stays byte-stable across ticks. `notes` remains the within-session scratchpad — the two are deliberately separate.

## API keys

Keys are read at startup from `.env` in the project root (or `%APPDATA%/SightLine/.env`) and stored encrypted via `safeStorage` (`electron/credentials.ts`). See `.env.example` for the full list. `ANTHROPIC_API_KEY` is the only one that's required; `ELEVENLABS_API_KEY` is the highest-value optional one (the human-sounding, low-latency voice), `OPENAI_API_KEY` powers hold-to-talk transcription plus a TTS fallback, and Google Cloud TTS uses `GOOGLE_PROJECT_ID` / `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`. Missing voice keys degrade the voice, never break the session.

## Persistence

Sessions, memory, and training plans persist to JSON under `%APPDATA%/SightLine/data` via `electron/db/store.ts`. Screenshots are **never** persisted — they live in memory for the length of a session only, and that's a privacy property worth keeping — with **one deliberate, user-approved exception**: training mode stores exactly one JPEG per explicit "Check my work" press (`data/plan-frames/<planId>/`, referenced by `TaskFeedback.frameFile`, deleted with the plan) so the coach can compare attempts across sessions. Do not widen this exception. `electron/db/schema.ts` holds the types and the equivalent Postgres DDL together so they can't drift; moving to Neon means implementing the same function signatures against it. Every table already carries a nullable `user_id` for when auth lands. See `docs/PRODUCTION.md`.
