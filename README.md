# SightLine

AI-powered screen-watching assistant for Windows. SightLine watches your screen
in real time and guides you step by step — for tech support, training
documentation, or learning from materials you choose.

You pick a mode, state a goal, and SightLine takes a screenshot every few
seconds, sends it to Claude along with full session context, and speaks the next
instruction through a floating overlay. You act, the screen updates, and the
cycle repeats.

## Stack

- **Electron** — desktop shell, always-on-top transparent overlay window
- **React 18 + TypeScript** — UI
- **Tailwind CSS** — styling
- **Zustand** — state management
- **Anthropic SDK** (`@anthropic-ai/sdk`) — Claude vision calls
- **OpenAI SDK** — Whisper voice transcription
- **Google Cloud TTS** — text-to-speech
- **Electron `safeStorage`** — API keys encrypted at rest (DPAPI on Windows)
- **uiohook-napi** — global mouse/keyboard hook for input-triggered captures

## Modes

SightLine launches with a mode picker. Each mode has its own system prompt,
polling behavior, and follow-up style:

| Mode | What it does |
| --- | --- |
| **Tech Support** | Walks you through a task step by step while watching your screen |
| **Training** | Builds a structured training document as you demonstrate steps on screen |
| **Teacher** | Helps you learn from sources you choose — a PDF, a paper, a site |

## Features

- Compact floating panel, always on top, semi-transparent when not in focus
- Draggable (via title bar) and resizable
- **D-pad control bar** — game-controller-style control surface with animated lava-lamp center button; arms toggle Steps, Ask (follow-up), Voice, and Attach
- **Adaptive polling** — three tiers: 2 s (alert, 20 s after any instruction), 15 s (normal), 30 s (idle after 3 unchanged frames)
- **Input-triggered captures** — global mouse/keyboard hook fires an immediate screenshot tick 750 ms after user activity (suppressed during the alert window to avoid TTS interruptions)
- **Peek** — shows a thumbnail of the last captured frame
- Status indicator: Watching / Thinking / Researching / Waiting / Paused / Error
- Completed steps list (toggleable)
- Follow-up text field with optional Whisper voice input
- Context upload — attach files or notes that Claude sees in every tick
- Configurable capture interval and multi-monitor selection
- Overlay opacity slider
- Auto-retry on API failure after 10 s; graceful 429 backoff with countdown
- Screenshots kept **in memory only** — never written to disk
- First-launch privacy notice

## Project layout

```
electron/               Electron main + preload (TypeScript)
  main.ts               Window + IPC handlers; uiohook-napi input hook
  preload.ts            contextBridge API surface
  capture.ts            desktopCapturer wrapper
  claude.ts             Anthropic call + mid-stream JSON extraction
  whisper.ts            OpenAI Whisper call
  credentials.ts        safeStorage-encrypted key store
  settings-store.ts     JSON-on-disk settings (non-secret)
  types.ts              Shared types used by both processes
src/                    React renderer
  App.tsx
  components/
    ModeSelect.tsx      Launch-time mode picker
    DPadControls.tsx    Animated D-pad control bar
    Instruction.tsx
    CompletedSteps.tsx
    FollowUpInput.tsx
    ConversationHistory.tsx
    GoalPrompt.tsx
    Settings.tsx
    Thumbnail.tsx       Peek frame viewer
    ...
  hooks/
    useSessionLoop.ts   Main capture → Claude → TTS loop
    useTts.ts           Audio state + speak/cancel
  store/
    session.ts          Zustand session state
    settings.ts         Zustand settings (wraps IPC)
  lib/
    api.ts              Re-exports SightLineApi type; returns window.sightline
```

## Develop

```sh
npm install
npm run dev
```

Runs Vite on <http://localhost:5173> and launches Electron pointing at it.

## Build a Windows installer

```sh
npm run dist
```

Produces an NSIS installer in `release/`.

## How a session works

1. User picks a mode and types or speaks a goal.
2. Renderer stores it and flips status to `watching`.
3. The session loop fires on a self-rescheduling timer (or immediately on user
   input via the global hook):
   - Call `capture.once` in the main process → PNG data URL of the chosen display.
   - Hash the frame; if unchanged, increment idle counter.
   - Push the frame to a rolling buffer of the last 5.
   - Call `claude.nextInstruction` with: mode, goal, completed steps, last 10
     conversation turns, attached context, and the last 5 frames as vision input.
   - Claude returns a JSON response; the renderer updates the panel and speaks
     the instruction via TTS.
4. The user acts; the next tick captures the updated screen and the cycle repeats.
5. When Claude marks the task `done`, status flips to `waiting` and the loop stops.

### Polling tiers

| Tier | Interval | When |
| --- | --- | --- |
| Alert | 2 s | 20 s after any instruction |
| Normal | `captureIntervalSec` (default 15 s) | Otherwise |
| Idle | 30 s | 3+ consecutive ticks with no screen change |

The global input hook fires an immediate tick 750 ms after mouse/keyboard
activity, but only outside the alert window (rapid activity during alert would
constantly interrupt TTS mid-sentence).

### Claude integration

`electron/claude.ts` streams the response and extracts the `"instruction"` field
mid-stream via regex, firing `onInstructionReady` before the full JSON arrives —
TTS starts speaking before the response finishes. The system prompt lives in
`SYSTEM_PROMPT` at the top of `claude.ts` and varies by mode.

### Error handling

- **Missing API key** — request returns `missing_api_key`; the panel opens Settings.
- **429 rate limit** — `Retry-After` header parsed; session pauses with a countdown.
- **Other failures** — error surfaced inline; retry scheduled in 10 s.
- **Screen capture denied** — error explains how to grant Windows screen-recording permission.

### Privacy

- Screenshots pass from `desktopCapturer` into the Anthropic API as base64 in
  memory — nothing written to disk.
- API keys are stored encrypted with Electron's `safeStorage`, not in plain text.
- **Pause** immediately halts the capture timer and all API calls.
- **Stop** clears the entire session including the frame buffer.
- On first launch a privacy notice spells out what gets sent and where.

## API keys

Place a `.env` in the project root (or `%APPDATA%/SightLine/.env`):

```env
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...          # optional — Whisper voice input only
GOOGLE_PROJECT_ID=...       # optional — Google Cloud TTS
GOOGLE_CLIENT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
```

Keys are read at startup and stored encrypted via `safeStorage`.

## License

MIT
