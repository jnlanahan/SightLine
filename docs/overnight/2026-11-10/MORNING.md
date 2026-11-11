# Morning: where the redesign stands

Written by session 1 on 11 November 2026, which built every step from 13 to 21 and did the machine half of step 22. The branch is `claude/overnight-2026-11-10-redesign`, pull request #10 into `one-coach` (a draft; nothing is merged).

**In one line:** the new main screen is built and every automatic check passes, but no one has seen it on a screen yet. Your run below is what decides whether it is right.

> **Since this was written (later on 11 November).** The screen has now been looked at on your machine, with stand-in chats and a scripted stand-in for the coach, and driven through a whole walkthrough. It matches the design. Six defects were found and fixed, and the work is merged into `one-coach`: replies showing under a finished goal; a quick answer at normal size; the header using your raw words over the chat's title; a false "Plan updated: removed …" note on nearly every new step; the view ceasing to follow after "I did it"; and step times no longer shown (now a tooltip on each finished step). There are 753 tests now. The first of "the three things most likely to be wrong" below (scrolling) was partly right and is fixed as far as it could be checked; the third (false plan notes) was right and is fixed. **Nothing below has been run with the real coach, the real voice or your real screen. The tick list is still yours.**

## Results

| Check | Result |
| --- | --- |
| `npm run lint` | Passes (both type-checks clean) |
| `npm test` | 739 passing, 46 files (536 when the night started) |
| `npm run build` | Passes. Manrope is bundled into the build; nothing is fetched from the internet |

## Acceptance checklist (`docs/redesign/IMPLEMENTATION.md`)

| Item | How it was checked | Evidence |
| --- | --- | --- |
| Layout follows DATA §2 and never drops back to quick within a sitting | Checked by a test | `phaseView.test.ts` (layoutOf, stickyLayout) and `usePhaseView.test.ts` (the floor holds when the upcoming list empties) |
| Rail, sections, checkpoints, lead line, footer, pill and composer match SPEC §3–4 | Checked by reading the code; **needs your eyes** | Every size and colour is taken from `src/design/tokens.ts` or written to the SPEC number; `phaseRail.test.ts` checks every rail colour comes from the palette. Whether it looks right can only be seen |
| Only one lead line, always the current step's instruction | Checked by a test | `phaseChat.test.ts` counts exactly one, including when the transcript has no matching line |
| Messages sit under their step, for new and old chats | Checked by a test | New chats: each message is tagged with its step (`phaseView.test.ts`, appendTurn tests). Old chats: placed by time (`groupTurns` tests, "places an old chat's untagged turns by time") |
| Auto-scroll follows SPEC §6.2; the view never moves while you are scrolled up | Checked by a test; **needs your eyes** for the feel | `useFollowCurrent.test.ts`: at the bottom it scrolls; scrolled up it shows the pill and does not scroll; reaching the bottom clears the pill; speech and silent looks never scroll |
| Plan changes show a note, an "Added" tag and a ringed dot; tail growth shows nothing | Checked by a test | `phaseView.test.ts` (diffPlan), `usePhaseView.test.ts`, `phaseRail.test.ts` (the ring), `phaseChat.test.ts` (the note) |
| Every coach state in SPEC §7 renders as specified | Checked by a test; **needs your eyes** | `coachStates.test.ts` covers every row of the table plus the three the plan added; the footer variants in `phaseFooter.test.ts` |
| Collapsed docked state is the rail, and screenshot exclusion still matches | Checked by reading the code; **needs your eyes** | The collapsed branch now draws `PhaseRail` instead of the old rail; the collapse call (`window.setCollapsed`) and the docking code are untouched, so the strip cut out of each screenshot is the same 64 px as before. Confirm with "See what the coach sees" |
| Palettes switch live, old settings migrate, the glow follows the palette | Migration and glow by a test; live switching by reading the code; **needs your eyes** | `paletteSettings.test.ts` (every old accent maps; the glow colours match each palette). The app re-themes from the saved setting, and the main process repaints the glow when the palette changes |
| Contrast passes; every icon button has a label; focus rings are visible | Contrast and labels by a test; focus rings by reading the code | `tokens.test.ts` and `restyle.test.ts` (all text pairs ≥ 4.5:1 in all three palettes); labels in `phaseRail.test.ts` and `phaseScreen.test.ts`; a focus ring rule in `src/index.css` covers every control |
| No technical words in the UI | Checked by a test and a search | See below |
| Old components and the accent system removed; lint and tests clean | Checked by a test | Five components deleted, 1,533 lines removed in step 20; `paletteSettings.test.ts` checks the accent setting is gone from the settings type |

## Banned words in the new screen

Searched every piece of wording in the new screen (the rail, header, phase chat, footer, ready pill, menu, needs-you banner, composer) for: session, capture, tokens, stance, stage. **None appear.** Tests check the phase chat, the menu and every needs-you message for them.

Outside the new screen, Settings (whose layout was not redesigned) still uses two of these words, unchanged by this work: a section called "Capture" and the switch "Remember me between sessions". Changing those was not part of this job.

## Your manual run (step 22, WP10 points 1 to 9)

Run `npm run dev` with the panel docked on the screen you are working on.

- [ ] **1. Quick question.** Ask "How do I freeze the top row?" You should see no rail, the answer in large type, and the mute, pause and collapse buttons in the header.
- [ ] **2. Short walkthrough.** Ask for something with a few steps. You should get a column of step circles on the left. Tap "I did it": the footer should say "Checking your screen", then the next step should appear in place.
- [ ] **3. Long goal with stages.** The rail should show phase circles with dots under them. When a phase finishes while you are at the bottom, the view should move to the next phase. Then scroll up, let a step finish, and check that a "Step … is ready" pill appears and the view does **not** move.
- [ ] **4. A plan change.** When the coach adds a step mid-way (saying "I'm stuck" often causes one), look for a dashed "Plan updated" note, an "Added" tag on the step, and a ring round its dot on the rail.
- [ ] **5. Collapse.** Collapse to the 64 px rail. Open "See what the coach sees" from the "⋯" menu (after expanding) and check the coach's picture leaves out exactly the strip the panel takes. The `[loop]` lines in the log should look as before.
- [ ] **6. The other states.** Pause; a rate limit (if one happens); no key (rename `.env` briefly); finishing a goal; and reopening a chat (look for "Picked up where you left off · …" and that it opens on the current phase).
- [ ] **7. Colours.** Try Graphite, Porcelain and Midnight (Settings → Appearance → Colours), including the outline drawn on your real screen. Put Graphite and Porcelain beside a bright program and decide which should be the default.
- [ ] **8. Keyboard only.** Tab through everything: every control should show a clear ring, in a sensible order (rail, header menu, chat, replies, message box).
- [ ] **9. Reduced motion.** Turn on Windows' "Animation effects: off". The halo should stop breathing and scrolls should jump instead of glide.

Also worth a look while you are there: **the "⋯" menu**, which the design did not draw (plan item 3), and the four fixes from the first live run, which this screen carries unchanged.

## The three things most likely to be wrong

1. **Scrolling and heights in a real window.** The current phase is meant to fill the view with past phases above it, and the view is meant to land on it when a chat opens, after expanding, and after closing About this chat. All of that depends on real layout, which the tests can only imitate. If anything looks off on first open (landing at the top, a short current section, a jump), it is most likely here (`src/hooks/useFollowCurrent.ts`).
2. **Home, Settings and About this chat in dark colours.** They were drawn for a light panel and were recoloured, not redrawn. Contrast is tested, but some faint lines and tints were tuned for light and may look too strong or too weak on Graphite and Midnight. Porcelain is the closest to how they looked before.
3. **Guesswork about steps.** The coach does not say which step it is on. The screen works it out: a step's title is the phrase the coach had queued for it, messages from older chats are placed by time, and plan changes are detected by comparing the coach's next 2 to 4 steps before and after each look. When the coach rewords its next steps, this can show a "Plan updated" note that was not really a change, or a step label that is slightly off. Every walkthrough also starts with a "Plan: N steps" note, because each one starts as a quick question until the coach lays out steps; that is what the design asks for, but it may feel like noise.
