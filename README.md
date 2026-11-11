# SightLine

A coach that watches your screen and talks you through whatever you are doing on your Windows PC.

You type or say a goal. SightLine looks at your screen and decides how to help: a one-line answer, a walkthrough one step at a time, or setting you a task and watching quietly while you practise. Every goal is a chat you can leave and come back to, with its conversation, plan and notes intact.

**It coaches; it never acts.** It cannot click or type on your machine. It tells you what to do, or it watches while you do it.

## What using it is like

- **One box.** No modes to pick and no setup questions. For anything bigger than a quick answer, the coach first says the goal back and what done will look like, and starts when you say yes.
- **Quiet by default.** It looks at the screen often and speaks only when a step is finished, you ask, or you are stuck. If you say "just watch", it stays silent until you say "check my work" or "I'm stuck".
- **The plan down the side.** A narrow rail shows the plan as numbered circles. A long goal is split into phases, each with its own conversation. The instruction for the step you are on is the one large line.
- **It points.** When there is a button to find, it outlines it on your real screen.
- **It speaks,** sentence by sentence as the answer arrives, and you can hold a key to talk back.
- **It remembers,** and you can see what: notes for each chat, and lasting facts about your setup. You can read, correct and forget any of it.
- **Docked.** The panel reserves a strip at the side of your monitor, so your other windows sit beside it instead of under it.

## Privacy

- Screenshots go from your screen to the Anthropic API in memory. **They are never written to disk.**
- Chats and memory are saved as files on your own PC (`%APPDATA%/SightLine/data-v2`). Nothing is stored on a server.
- API keys are stored encrypted on your PC (Electron `safeStorage`, which uses Windows DPAPI).
- Pause stops all looking at once. A notice on first launch says what is sent and where.

## Run it

```sh
npm install
npm run dev
```

You need an Anthropic API key. Copy `.env.example` to `.env` and fill it in; the other keys are optional and improve the voice. A missing voice key lowers the voice quality and never stops the app.

```sh
npm test          # unit tests
npm run lint      # type-check both halves
npm run build     # production build
npm run dist      # Windows installer, in release/
```

How it sounds, how it paces itself and how it reads your screen can only be judged by running it.

## How it is built

Electron, React and TypeScript, in two halves joined by one bridge:

- `electron/` is the main process: windows, screen capture, docking, speech, saved chats and memory, and the coach itself (`electron/agents/`), which talks to Claude.
- `src/` is the panel you see: the loop that decides when to look, the speech queue, and the screens.
- `electron/preload.ts` is the bridge between them.

[CLAUDE.md](CLAUDE.md) describes all of it in detail and is the place to start before changing anything. The other documents:

| Document | What it is |
| --- | --- |
| [docs/ONE-COACH-PLAN.md](docs/ONE-COACH-PLAN.md) | The build plan this version came from, what has been run live and what has not |
| [docs/REDESIGN-BRIEF.md](docs/REDESIGN-BRIEF.md) | What the app does, written for a designer |
| [docs/redesign/](docs/redesign/README.md) | The design of the main screen: decisions, measurements, colours |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | What is needed before other people use it: accounts, cloud storage, an installer |

## License

MIT
