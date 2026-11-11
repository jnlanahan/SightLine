# Spec: the phase-chat screen

Sizes are CSS px at 100% zoom. Colours are token names from `tokens.ts` (`t.accent`, `t.ink2`, …), never raw hex in components. When this spec and the reference prototypes disagree, this spec wins.

## 1. Surfaces

| Surface | Layout | Notes |
| --- | --- | --- |
| Docked, expanded | Rail (64) + content column (rest). Default total width 400, user-draggable as today | Opaque, rectangular, full height (brief §12) |
| Docked, collapsed | Rail only, 64 wide | Replaces `DockRail.tsx`. The reserved strip shrinks to 64 as today |
| Floating, expanded | Same layout as docked, corner radius 14 | No translucency yet (not designed) |
| Floating, collapsed | Keep today's compact bar, restyled with tokens | Not redesigned |
| On the user's screen | Watched-area outline and pointer highlight drawn by the glow window | Colour = `t.accent` of the active palette (§9) |

## 2. Anatomy (phased layout, docked)

```
┌──────┬──────────────────────────────────┐
│ [≡]  │ Set up the work VPN          [⋯] │  header 60
│      │ Phase 2 of 3 · step 1 of 2 · Watching
│  ✓   ├──────────────────────────────────┤
│  ·   │ PHASE 1 OF 3              ✓ Done │  past phase (compact)
│  ·   │ Get to the VPN settings          │
│  │   │ ✓ Step 1 · Open Settings         │
│ (2)  │     …messages…                   │
│  ·   ├──────────────────────────────────┤
│  ○   │ PHASE 2 OF 3          ● Watching │  current phase
│  │   │ Add the connection               │  (card bg, min-height = viewport)
│ (3)  │ (3) Step 3 · Click Add VPN       │
│      │     Click Add VPN at the top     │  ← lead line, 21/600
│      │     right. When it asks for a    │
│      │     server, paste this:          │
│      │     [vpn.northwind.example][Copy]│
│      │     you: which one?          ▸   │
│      │     Add VPN. Advanced comes…     │
│      │                                  │
│      │  ⬚ Outlined on your screen. I'll │  footer (margin-top: auto)
│      │    move on when I see it's done. │
│ [🔈] │  (✓ I did it) (I'm stuck)        │
│ [⏸] │         ( Phase 3 is ready ↓ )   │  ready pill (only when scrolled up)
│ [»]  │ [ Ask about step 3        ][🎤] │  composer
└──────┴──────────────────────────────────┘
```

## 3. Phase rail

Width 64, full height, `background: t.rail`, `border-right: 1px solid t.line`. A flex column, items centred, padding 8 top, 10 bottom.

### 3.1 Top
- **All chats** button: 44 × 44, radius 10, transparent, list icon 20 stroke 1.8, colour `t.ink`. Goes to Home. `aria-label="All chats"`.

### 3.2 Phase list (phased layout)
Starts 28 below the button. For each phase, in order:

- **Connector** above every phase except the first: 2 wide × 22 tall. Colour: `t.doneFill` when the phase above it is done, `t.accent` when this phase is current, `t.line` when upcoming.
- **Circle**
  - Done: 30 × 30, `background: t.doneFill`, check icon 14 (stroke 3), `color: t.doneInk`. A button that scrolls to that phase. `aria-label="Phase 1, done: Get to the VPN settings"`.
  - Current: 38 × 38, `background: t.accent`, number 16 / 700, `color: t.onAccent`. Halo behind it (§8). A button that scrolls to the phase. `aria-label="Phase 2, current: Add the connection"`.
  - Upcoming: 30 × 30, `border: 1.5px solid t.muted`, number 13 / 400, `color: t.ink2`. Not interactive: `role="img"` with an aria-label, and the title shown as a native tooltip.
- **Step dots** under the circle: 6 × 6 circles, gap 4, 8 above. Done `t.doneFill`, current `t.accent`, upcoming `t.muted`. A step added this sitting also gets a ring: `box-shadow: 0 0 0 2px t.rail, 0 0 0 3.5px t.accent`. Dots are `aria-hidden`.
  - **Upcoming phases show no dots.** The coach writes a stage's steps only when the user reaches it (D3).

If the list is taller than the space between the top button and the bottom controls, it scrolls inside the rail with the scrollbar hidden. It keeps the current circle in view, and a 16 px fade at the cut edges shows there is more.

### 3.3 Single-phase layout (steps, no stages)
The rail shows the **steps** as circles instead of phases: done 26 (check 12), current 34 (number 14 / 700, halo), upcoming 26 (number 12), with 20-tall connectors. There are no dots.

### 3.4 Quick layout
No rail. See §5.

### 3.5 Bottom controls
A flexible spacer, then **Mute voice**, **Pause watching** and **Collapse**, each 44 × 44, radius 10, icon 18, `color: t.ink2`. Mute shows the speaker-off icon when muted. Pause becomes **Resume watching** when paused. Collapse becomes **Expand** when collapsed, with the chevrons reversed. Every one has an aria-label that states the action it will take.

### 3.6 Collapsed
The rail on its own. Same contents. The current circle's `title` and accessible description carry the latest coach line (the brief's "hint of the latest line"). Clicking a phase circle while collapsed expands the panel and scrolls to that phase.

## 4. Content column

`flex: 1; min-width: 0`, a flex column, `position: relative` (for the ready pill).

### 4.1 Header
Padding 8 / 4 / 8 / 20, `border-bottom: 1px solid t.line`.
- Title: the chat title, 14 / 700, `t.ink`, one line with ellipsis.
- Status line: 12 / 400, `t.ink2`. Phased: `Phase {n} of {N} · step {k} of {K} · {state}`, where k and K count within the current phase. Single phase: `Step {k} of {K} · {state}`. Quick: `{state}` with a 7 px `t.accent` dot before it.
- **Menu** button on the right: 44 × 44, three-dot icon, `t.ink2`. It opens today's menu (Settings, About this chat, …), restyled.

### 4.2 Scroll area
`flex: 1; min-height: 0; overflow-y: auto; position: relative`, thin scrollbar. It holds every phase section from the first to the current one, in order. Upcoming phases are not rendered.

### 4.3 Phase section: past
Padding 20, gap 10, `border-bottom: 1px solid t.line`, background transparent (`t.bg`).
- Eyebrow row: `PHASE {n} OF {N}` at 11 / 700, tracking 1.2 px, uppercase, `t.ink2`. On the right, a check icon 13 and "Done" at 12, `t.ink2`.
- Title: 15 / 600, `t.ink2`, 4 px pulled up.
- Its step checkpoints and messages (§4.5), with coach text in `t.ink2`.

### 4.4 Phase section: current
`min-height: 100%` of the scroll area, so the current phase owns the viewport and past phases sit above it. Padding 24 / 20 / 18, gap 12, `background: t.card`.
- Eyebrow row: as for a past phase, but on the right a 7 px `t.accent` dot plus the state word (§7), 12, `t.ink2`.
- Title: 18 / 700, `t.ink`.
- Step checkpoints with their messages.
- Footer (§4.6), pushed to the bottom with `margin-top: auto; padding-top: 10`.

### 4.5 Step checkpoint and messages
- Checkpoint row: gap 10, 6 above.
  - Circle 20 × 20: done = `t.doneFill` with check 11 (`t.doneInk`); current = `t.accent` with the number 11 / 700 (`t.onAccent`).
  - Label `Step {n} · {title}`: 13 / 700 `t.ink` if current, else 13 / 600 `t.ink2`. Numbering is global across the whole chat.
  - "Added" tag when the step was added this sitting: 10.5 / 700, uppercase, tracking 0.6, `border: 1px solid t.accent`, radius 999, padding 1 / 7.
- Messages, indented 30 (aligned with the label text), gap 10:
  - **Lead line**: the coach instruction for the step in progress, 21 / 600, line height 1.35, tracking −0.3, `t.ink`. Exactly one on screen. In past steps the same line drops to body style.
  - **Coach body**: 13.5 / 400, line height 1.5, `t.ink` (current phase) or `t.ink2` (past).
  - **User message**: right-aligned bubble, max width 86%, padding 8 / 12, radius 12 12 4 12, `background: t.you`, 13.5 / 1.45.
  - **Code block**: `background: t.code`, `border: 1px solid t.line`, radius 10, padding 4 / 4 / 4 / 12; mono 13 (`font.mono`); a Copy button 34 tall, radius 8, `t.btn` / `t.btnInk`, 12 / 600. A long line scrolls sideways inside the block; the panel never scrolls sideways.
  - **Plan note**: `border: 1px dashed t.accent`, radius 10, padding 8 / 10, plus icon 14, 12.5 `t.ink2`. Wording in §10.
  - **Resume divider** (§6.5): a 1 px `t.line` rule with centred text 11.5 `t.ink2`.

### 4.6 Footer of the current phase
- **Highlight note** (only while the coach is pointing at something on screen): dashed-square icon 14 plus "Outlined on your screen. I'll move on when I see it's done." at 12.5 `t.ink2`. With no highlight, show "I'll move on when I see it's done." only. While watching, show neither.
- **One-tap replies**: pills 38 tall, radius 999, `border: 1px solid t.chip`, transparent, 13 / 600 `t.ink`, padding 0 / 14, gap 8.
  - Guide: **I did it** (check icon 13) sends `"Done — what's next?"`; **I'm stuck** sends `"I'm stuck"`.
  - Watch: **Check my work** sends `"Check my work"`; **I'm stuck** sends `"I'm stuck"`.
  - These are the same plain-words follow-ups the app sends today, so the coach needs no change.
- **While the coach is looking after a reply** (status `thinking`): the pills are replaced by a status row 38 tall: an 8 px `t.accent` dot pulsing (§8) plus the state text from §7, 13 / 600 `t.ink2`, with `role="status"`.

### 4.7 Ready pill
Shown only when the coach moved on while the user was scrolled up (§6.2). Absolutely positioned, centred, 76 above the bottom of the content column. 40 tall, radius 999, padding 0 / 16, `background: t.accent`, `color: t.onAccent`, 13 / 700, down-arrow icon 14, shadow `0 6px 18px rgba(0,0,0,0.25)`. Rises in over 250 ms. Wording in §10.

### 4.8 Composer
Margin 0 / 12 / 12. Radius 14, `background: t.input`, `border: 1px solid t.line`, padding 4 / 4 / 4 / 14.
- Input 44 tall, 14 / 400, `t.ink`, no border. It has a visually hidden label, "Message the coach".
- Placeholder: `Ask about step {n}` (plan running), `Ask or tell it anything` (new chat), `Ask a follow-up` (done or quick).
- **Hold to talk** button 44 × 44, radius 12, `t.btn` / `t.btnInk`, mic icon 18. While listening: `background: t.accent`, `color: t.onAccent`. Keep today's press-and-hold logic in `Composer.tsx` exactly; restyle it only.
- Keep the attach-file control if `Composer.tsx` has one today, as an icon button 44 × 44 left of the input.

## 5. Quick layout (no plan)

No rail. The content column is the full width.
- Header: All chats (44), title plus status line (§4.1), then Mute, Pause, Collapse and Menu at 40 × 44 each, on the right.
- One section, `background: t.card`, padding 24 / 20 / 18, gap 14, filling the scroll area: the user's question as a bubble, the coach's answer as the lead line (21 / 600), the highlight note if pointing, then any follow-up turns at body size.
- Bottom of the section: `Watching quietly.` (12.5 `t.ink2`, accent dot), then up to two coach-suggested follow-ups as pills, if the coach provides them. With none, show none. Do not invent them in the UI.
- Composer as in §4.8.
- Collapsed while quick: a 64 rail with All chats, a 34 accent circle holding a check (done) or the halo dot (watching), and the bottom controls.

## 6. Behaviour

### 6.1 Which layout
Decided by `DATA.md` §2 on every render. A switch from quick to single or phased animates the rail in: width 0 → 64 over 200 ms, content opacity 0 → 1. It also adds a plan note: "Plan: {N} phases" or "Plan: {K} steps".

### 6.2 Moving on, and auto-scroll
"At bottom" means `scrollTop + clientHeight >= scrollHeight − 60`. Measure it **before** applying the coach's turn that completes a step.
- **Step finished, same phase:** a new checkpoint and lead line appear in the current section. If at bottom, scroll so the new checkpoint is 16 below the top of the viewport, but only if it would otherwise sit within 140 of the bottom edge. If not at bottom, show the pill.
- **Phase finished:** the finished section turns into the compact past style, and the next phase's section is added. If at bottom, scroll smoothly so the new section's top meets the viewport top. If not, show the pill.
- **Goal reached:** add the completion section (§6.6), with the same at-bottom rule.
- The pill clears when tapped (it scrolls to the target) or when the user reaches the bottom by hand.

### 6.3 Rail navigation
Clicking a done or current circle smooth-scrolls its section to the top of the viewport. Upcoming circles do nothing.

### 6.4 Plan changes
Compare the coach's plan before and after each turn (`DATA.md` §4). Added steps get the "Added" tag and a ringed dot for the rest of the sitting. Every change also adds one plan note in the current step's message list. Do not add a note for plain progress (a step moving from upcoming to done).

### 6.5 Reopening a chat
Open with the current phase section at the top of the viewport (no animation). When the coach's resume greeting arrives, insert a resume divider under the current step first: `Picked up where you left off · {relative time}`, with the time taken from `resumePending.awayMinutes`. The greeting itself is a coach message. If it gives the current step's instruction again, it becomes the lead line.

### 6.6 Goal reached
After the last phase section, add a section with `min-height: 100%`, padding 40 / 20, gap 14: a 44 accent circle with a check, the headline (22 / 700), and one body line (14 `t.ink2`) from §10. The rail shows every phase done, with no halo. The composer placeholder becomes "Ask a follow-up". The chat stays open.

### 6.7 Things that must not move the view
Speech streaming in, the coach looking, a "wait" turn, an error banner appearing, or the user typing. Only §6.2 and §6.3 scroll.

## 7. Coach states on this screen

| State (`SessionStatus` + context) | Header and section state word | Rail halo | Footer |
| --- | --- | --- | --- |
| Watching (`watching`) | "Watching" | Breathing | One-tap replies |
| Looking (`thinking`, no follow-up pending) | "Watching". It must not promise speech | Breathing | One-tap replies |
| Looking after the user asked (`thinking` with a follow-up) | "Looking" | Breathing | Status row: "Looking at your screen" |
| After "I did it" (`thinking`) | "Checking" | Breathing | Status row: "Checking your screen" |
| Looking closer (`activeTool = read_screen_region`) | "Taking a closer look" | Breathing | Status row, same words |
| Looking it up (`activeTool = search_web`) | "Looking that up" | Breathing | Status row, same words |
| Speaking | "Watching" | Breathing | The lead line types in as it is spoken (keep today's typewriter, capped as now) |
| Listening (mic held) | "Listening" | Breathing | The mic button turns accent. Text heard so far shows in the input |
| Paused (`paused`) | "Paused" | **Off**: the current circle drops to `t.muted` with a pause glyph | One pill, filled `t.accent`: "Resume watching" |
| Needs you (`error`, no key, cap reached, rate limited, wrong screen) | "Needs you" | Off | A banner at the top of the current section (below) |
| Done | "Done" | None | Completion section |

**Needs-you banner:** radius 12, padding 12 / 14, `border: 1px solid t.warn`, `background: t.warnSoft`. A 13.5 / 600 `t.ink` line saying what is wrong in plain words, then one action as a pill ("Add a key", "Raise the cap", "Pick the screen", "Try again"). A rate-limit wait shows the countdown, as today. Wording in §10.

## 8. Motion

| Thing | Animation |
| --- | --- |
| Rail halo | A radial gradient of `t.accent` to transparent at 70%, `inset: -12px`. Scales 0.85 → 1.2 → 0.85 and fades 0.25 → 0.6 → 0.25 over 5 s, ease-in-out, looping |
| Status dot | Opacity 0.35 → 1 → 0.35 over 1.2 s, looping |
| Ready pill | translateY 8 → 0 and opacity 0 → 1, 250 ms ease-out |
| Rail entering | Width 0 → 64, 200 ms |
| Scrolls | `behavior: smooth`, except on first open |

`prefers-reduced-motion: reduce` turns all of these off. The halo then shows at a still 0.4 opacity, and scrolls become instant.

## 9. Theme

- Three palettes: **Graphite** (default), **Porcelain** and **Midnight**, all in `tokens.ts`. They replace the four-accent setting (`DECISIONS.md` D9).
- Settings → Window: "Colours: Graphite · Porcelain · Midnight" as a segmented control, replacing the accent swatches.
- The glow overlay (the watched-area outline and the pointer box on the user's real screen) uses the palette's `glow` colour.
- Type: `font.sans` (Manrope, bundled via `@fontsource-variable/manrope`, Segoe UI fallback) and `font.mono` (Cascadia Mono, Consolas). The scale is in `tokens.ts`.

## 10. Wording

| Where | Text |
| --- | --- |
| Footer, pointing | Outlined on your screen. I'll move on when I see it's done. |
| Footer, not pointing | I'll move on when I see it's done. |
| One-tap, guide | I did it · I'm stuck |
| One-tap, watch | Check my work · I'm stuck |
| Status row | Checking your screen · Looking at your screen · Taking a closer look · Looking that up |
| Ready pill | Phase {n} is ready · Step {n} is ready · All done |
| Plan notes | Plan: {N} phases · Plan: {K} steps · Plan updated: added "{step}" · Plan updated: removed "{step}" · Plan updated: {n} steps changed · Plan updated: added phase "{title}" |
| Resume divider | Picked up where you left off · {5 minutes / 2 hours / 3 days} ago |
| Goal reached | {Coach's last line as the headline if it is under 60 characters, else "Done."} / This chat stays open. Ask anything about it later and I'll pick up from here. |
| Quick, idle | Watching quietly. |
| Needs you | No AI key yet. Add one to start. · You've reached your spending cap for this sitting. · The AI service asked us to wait. Trying again in {s}s. · I can't see the screen you picked. |
| Paused | Paused · Resume watching |

No technical words in the UI: no "session", "capture", "tokens", "stance" or "stage".

## 11. Accessibility

- Every token pair used for text meets 4.5:1. Check this with the test in `IMPLEMENTATION.md` WP1.
- Every control is a real `<button>` or `<input>` with a visible focus ring: `outline: 2px solid t.accent; outline-offset: 2px`.
- Every icon-only button has an aria-label (listed in §3 and §4).
- The lead line container is `aria-live="polite"`, and status rows are `role="status"`.
- Tab order: rail top → phase circles → rail bottom controls → header menu → scroll area content (code Copy buttons, one-tap replies) → ready pill (when shown) → composer.
- Keyboard: the existing push-to-talk key is unchanged. `Esc` in the composer clears it.
- Touch targets are at least 38 tall, and icon buttons are 44.
