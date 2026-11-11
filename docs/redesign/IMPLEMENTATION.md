# Implementation

Work packages in order. Each one ends green: `npm run lint` and `npm test` pass, and the app still runs. Commit once per package. Branch: `redesign/phase-chats`.

Read `CLAUDE.md` first. This redesign is renderer work plus one small data addition. The coach, the loop, capture, docking and TTS do not change.

## Invariants not to break

These come from `CLAUDE.md`. Each is easy to break while moving UI around.

- **The loop's guards stay as they are** (`useSessionLoop.ts`): `inFlightRef`, spacing, budget, `rateLimitUntil`, listening/transcribing, stale-result discarding. One-tap replies must go through the existing `submitFollowUp`, never a new path.
- **One-tap replies send the same plain words as today:** `"Done — what's next?"`, `"Check my work"`, `"I'm stuck"`. The coach's rules depend on them.
- **The press-and-hold mic logic in `Composer.tsx` is untouched.** Restyle it only. A latched-open mic is the worst failure here.
- **The capture exclusion rule:** the docked strip is cut out of every frame. Collapsing to 64 px must keep going through the existing dock and capture code, so the strip width the capture code subtracts matches what is on screen.
- **Docking can never make the app unusable:** if koffi fails, the app still floats.
- **Screenshots are never persisted.** Nothing in this redesign stores pictures.
- **Anything written to disk is shape-checked in the main process** (`isChatRecordShape`). The new turn fields go through it.
- **`[loop]` and `[timing]` logs stay.**

## WP1 · Tokens, palette setting, font

- Add `src/design/tokens.ts` (copy `docs/redesign/tokens.ts`).
- Rework `src/design/theme.ts` and `ThemeProvider.tsx` so the theme context exposes the active `Palette` plus `font`, `type`, `size`, `radius` and `motion`. Remove `ACCENTS`, `makeTheme`, `waveColor` and the porcelain constants once nothing uses them (WP8 finishes the cleanup).
- Settings data: add `palette: PaletteName` to the settings type in `electron/types.ts`, defaulting to `"graphite"` in `electron/settings-store.ts`. On first read of an old settings file with `accentColor` and no `palette`, set `palette = ACCENT_TO_PALETTE[accentColor]`. Keep reading `accentColor` for that migration only, then stop writing it.
- `src/main.tsx`: read `palette` instead of `accentColor`.
- Glow overlay: `electron/main.ts` currently maps `accentColor` → `GLOW_ACCENTS`. Map `palette` → `PALETTES[palette].glow` instead, and keep the existing "colour changed → repaint glow" behaviour keyed on `palette`.
- Font: add `@fontsource-variable/manrope` and import it once in `src/main.tsx`. Set `font.sans` on `body` in `src/index.css`. Set the window background colour to `PALETTES[palette].bg` so there is no white flash.
- Tailwind: the `sl` colour set in `tailwind.config.js` is the old palette. Do not extend it. New components use the theme context. Leave the old keys until WP8.
- **Test:** `src/__tests__/tokens.test.ts` checks that every text pair (`ink`/`bg`, `ink`/`card`, `ink2`/`bg`, `ink2`/`card`, `ink2`/`rail`, `onAccent`/`accent`, `doneInk`/`doneFill`, `ink`/`you`, `btnInk`/`btn`, `ink`/`input`, `ink`/`code`) is at least 4.5:1 in all three palettes. Extend `dockSettings.test.ts` or a settings test so the migration maps every old accent.

## WP2 · Turn tags and the phase view model

- Add the optional `stage` and `step` fields to `ConversationTurn` and `ChatTurnRecord` (`DATA.md` §5). Set them in `addTurn`, and confirm the step-log update lands before the coach turn is appended.
- Carry them through `electron/chat-record.ts` and accept them in `isChatRecordShape`.
- Add `src/lib/phaseView.ts`: `layoutOf`, `buildPhaseView`, `diffPlan` and `groupTurns`, as in `DATA.md` §2–5. Reuse `toPlanSteps`.
- **Tests:** everything in `DATA.md` §6, plus `sessionRecord`/chat-record round trips keeping the new fields and loading turns without them.

## WP3 · Phase rail

- New `src/components/PhaseRail.tsx`: SPEC §3 in full (phased, single and quick-collapsed variants, step dots, the "added" ring, the halo, the bottom controls, a scrolling list with edge fades).
- Props: the `PhaseView`, the session flags (muted, paused, collapsed) and callbacks (`onAllChats`, `onPhase(i)`, `onMute`, `onPause`, `onCollapse`).
- The halo and dot animations go in `src/design/sightline.css` as keyframes, with a `prefers-reduced-motion` block.
- **Collapsed:** the same component replaces `DockRail.tsx` in `App.tsx`'s collapsed branch. Keep the existing collapse wiring (window resize, AppBar strip width) and only change what renders.

## WP4 · Phase chat

New components under `src/components/phase/`:

- `PhaseChat.tsx`: the scroll area (SPEC §4.2), rendering `PhaseSection`s from the view model, plus the completion section (§6.6). It owns the scroll container ref.
- `PhaseSection.tsx`: past and current styles (§4.3–4.4), the eyebrow row and the title.
- `StepCheckpoint.tsx`: the circle, the label and the "Added" tag (§4.5).
- `Message.tsx`: coach body, user bubble, plan note and resume divider.
- `LeadLine.tsx`: the current instruction at lead size, with today's typewriter from `Instruction.tsx` moved here and `aria-live="polite"`. Includes the code block.
- Restyle `CodeBlock.tsx` to SPEC §4.5. Keep its copy behaviour and make long lines scroll sideways.
- Fold the error display from `Instruction.tsx` into the needs-you banner (WP7).

## WP5 · Footer, ready pill, auto-scroll

- `PhaseFooter.tsx`: the highlight note, the one-tap replies by stance, and the status row while thinking (SPEC §4.6, §7). Wire the replies to `submitFollowUp` with the exact strings.
- Pointing: show "Outlined on your screen…" only while the glow window has an active pointer box. Use whatever state `App.tsx` already has for the highlight, and add a boolean to the store only if none exists.
- `ReadyPill.tsx`: SPEC §4.7.
- `src/hooks/useFollowCurrent.ts`: the at-bottom measurement and scroll rules from SPEC §6.2–6.3 and §6.7. It measures before applying a step-completing turn, decides between scroll and pill, clears the pill on reaching the bottom, and provides `scrollToPhase(i)` for the rail.
- **Test** (`useFollowCurrent.test.ts`, jsdom): at bottom → scrolls; scrolled up → pill and no scroll; reaching the bottom clears the pill; speech or a `wait` never scrolls.

## WP6 · Header, composer, quick layout, layout switch

- `PanelHeader.tsx`: SPEC §4.1, plus the quick-layout variant with the controls (§5).
- Restyle `Composer.tsx` to SPEC §4.8 with dynamic placeholders. Keep every handler.
- Quick layout (SPEC §5) and the collapsed quick rail.
- The rail entering animation and the "Plan: …" note when the layout changes mid-chat (§6.1), using the sticky `layoutFloor`.
- Replace the open-chat branch in `App.tsx` (around the `ProgressRail`, `ConversationHistory` and `Instruction` block) with `PanelHeader`, `PhaseRail`, `PhaseChat`, `ReadyPill` and `Composer`. Keep About this chat reachable from the menu, as today.

## WP7 · States

- Map `SessionStatus` + `activeTool` + `pendingFollowUp` + `stance` to the state words and footer variants in SPEC §7, in one function in `phaseView.ts` (test it).
- Paused: the halo off, a muted current circle with a pause glyph, and the "Resume watching" pill.
- Needs you: the banner (SPEC §7, wording in §10), driven by the existing error, no-key, budget, rate-limit and wrong-screen states. Keep the rate-limit countdown (`useRateLimitCountdown`).
- Resume divider from `resumePending` (§6.5).
- Done: the completion section, a rail with no halo, and the placeholder change.

## WP8 · Remove what the redesign replaces

- Delete `ProgressRail.tsx` (`ProgressRail`, `PlanList`, `StageList`), `DockRail.tsx`, `ConversationHistory.tsx` and `Instruction.tsx` once nothing imports them, plus `TrainingActions` inside `App.tsx`.
- Remove `ACCENTS`, the old theme, the accent swatches in `Settings.tsx` and the `sl` Tailwind colours, and update any leftover users.
- Remove `accentColor` from the settings type after the migration in WP1 has run (keep the migration read).
- `npm run lint` must show no unused exports left behind.

## WP9 · Restyle the other screens (no layout changes)

Apply the tokens (colours, font, radii, focus rings) to `Home.tsx`, `AboutChat.tsx`, `Settings.tsx`, `PrivacyNotice.tsx` and `ScreenPicker.tsx`. Do not change their structure; those layouts are not designed yet. In Settings → Window, replace the accent swatches with the palette segmented control (SPEC §9).

## WP10 · Verify

- `npm run lint` and `npm test` are green.
- Manual run (`npm run dev`), docked on the watched monitor:
  1. Quick: "How do I freeze the top row?" shows no rail, a lead-size answer and the controls in the header.
  2. Short walkthrough: rail of step circles; "I did it" shows "Checking your screen", then the next step appears in place.
  3. Long staged goal: rail of phases with dots; finishing a phase moves to the next phase chat when at the bottom; scroll up and finish a step → the pill appears and no scroll happens.
  4. A plan change mid-chat shows a note, the "Added" tag and the ringed dot.
  5. Collapse → 64 px rail, and the captured frame still excludes exactly the strip (check `[loop]` logs and "see what the coach sees").
  6. Pause, a rate limit, no key, done, and reopening a chat (resume divider, lands on the current phase).
  7. All three palettes, including the glow overlay colour.
  8. Keyboard-only pass: tab order per SPEC §11, a visible focus ring everywhere.
  9. Reduced motion on: no halo motion, instant scrolls.

## Acceptance checklist

- [ ] Layout follows `DATA.md` §2, and never drops back to quick within a sitting.
- [ ] Rail, sections, checkpoints, lead line, footer, pill and composer match SPEC §3–4 measurements and tokens.
- [ ] Only one lead line on screen, always the current step's instruction.
- [ ] Messages sit under the step they belong to, for new and old chats.
- [ ] Auto-scroll follows SPEC §6.2. The view never moves while the user is scrolled up.
- [ ] Plan changes show a note, an "Added" tag and a ringed dot. Tail growth of the upcoming list shows nothing.
- [ ] Every coach state in SPEC §7 renders as specified.
- [ ] Collapsed docked state is the rail, and capture exclusion still matches.
- [ ] Palettes switch live, old settings migrate, and the glow follows the palette.
- [ ] Contrast test passes. Every icon button has an aria-label. Focus rings are visible.
- [ ] No technical words in the UI (SPEC §10).
- [ ] Old components and the accent system are removed. Lint and tests are clean.
