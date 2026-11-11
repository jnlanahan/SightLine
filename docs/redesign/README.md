# SightLine redesign: Phase chats

The design for SightLine's new main screen, ready to build. It sits on top of `docs/REDESIGN-BRIEF.md` (what the app does) and does not change what the coach does, only how the open chat looks and behaves.

Chosen 10 November 2026, after three rounds of exploration on a design canvas. `DECISIONS.md` has the history and the reasons.

## The design in one paragraph

The docked sidebar splits into two columns. On the left, a 64 px **phase rail** shows the plan as numbered circles: a check for a finished phase, a glowing number for the current one, an outline for the ones still to come, and a dot for each step under its phase. On the right is the **phase chat**: one conversation per phase, stacked in a single scroll. Steps sit inside a phase as checkpoints, and the instruction for the current step is set large enough to read at a glance. When the coach sees a phase is finished, it moves to the next phase's chat. If the user has scrolled up to reread, it shows a "Phase 3 is ready" pill instead. A quick question has no plan, so it gets no rail. Collapsing the panel hides the right column and leaves the rail, so the collapsed state comes for free.

## Read in this order

| File | What it holds |
| --- | --- |
| `README.md` | This page: scope, how to hand it off, what done means |
| `DECISIONS.md` | What was explored, what was chosen and why, the trade-offs accepted, answers to the brief's open questions |
| `SPEC.md` | The screen, measured: layout, every component, states, behaviour, motion, accessibility, wording |
| `DATA.md` | How the existing chat and session data become phases and steps, and the one small data addition this needs |
| `IMPLEMENTATION.md` | Ordered work packages mapped to files in this repo, tests to add, invariants not to break, acceptance checklist |
| `tokens.ts` | The three colour palettes, type scale, spacing, radii and motion values, ready to drop into `src/design/` |
| `reference/` | The two prototype sources the design was signed off on (see `reference/README.md`) |

## Scope

In scope:

- The open-chat screen in the docked sidebar: phase rail, phase chat, header, one-tap replies, composer, ready pill.
- The same screen for a quick answer (no plan) and for a walkthrough with no stages (one phase).
- Coach states on that screen: watching, looking, speaking, looking closer, listening, paused, needs you, done.
- The collapsed docked state (the rail on its own).
- New colour palettes and type, replacing the four-accent setting.
- Applying the new tokens to Home, About this chat, Settings, the privacy notice and the screen picker, **without** redesigning their layouts.

Out of scope for this package (not designed yet; keep current behaviour, restyled with the tokens):

- New layouts for Home, first run, About this chat, About you and the menu.
- The floating panel's translucency and its one-line collapsed bar.
- The AI key entry screen the brief asks for.

## Handing this to Claude Code

Put this folder at `docs/redesign/` (it is already there if you are reading it in the repo), then start Claude Code in the repo root with something like:

> Read `docs/redesign/README.md` and every file it lists, in order, then read `CLAUDE.md`. Implement the redesign by following `docs/redesign/IMPLEMENTATION.md` one work package at a time. Work on a branch named `redesign/phase-chats`. After each package, run `npm run lint` and `npm test`, fix anything that fails, and commit with a message naming the package. Do not change the coach, the loop, capture or docking behaviour; if a package seems to need that, stop and tell me why. When a measurement or colour is in `SPEC.md` or `tokens.ts`, use it exactly. Where the spec is silent, follow the reference prototypes in `docs/redesign/reference/`, and list each such call in your final summary.

## What done means

- Every item in the acceptance checklist at the end of `IMPLEMENTATION.md` passes.
- `npm run lint` and `npm test` pass, including the new tests listed there.
- A manual run covers a quick question, a short walkthrough and a long staged goal, docked and collapsed, in all three palettes.
