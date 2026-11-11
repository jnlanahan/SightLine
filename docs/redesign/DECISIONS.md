# Decisions

How the phase-chat design was reached, what it commits to, and what it gives up. Read this before changing anything in `SPEC.md`, so a change does not undo a choice that was made on purpose.

## How we got here

The brief (`docs/REDESIGN-BRIEF.md`) asks for one coach, one input box and a list of chats, in a strip about 400 px wide that sits beside the program the user is working in. Every option below was drawn at 400 × 900 on the same moment: step 3 of a VPN walkthrough, with the coach watching quietly.

### Round 1: four directions

| Option | Idea | Why it was not chosen |
| --- | --- | --- |
| A · Prompter | Current identity evolved: a big serif card holding the latest line, with history faded above | Glanceable, but history was cramped and quick answers looked lost in the big card |
| B · Thread | A standard messaging layout with bubbles | Familiar, but the latest line drifts and shrinks as the chat grows, and it reads as a chatbot waiting for a reply, which works against "quiet by default" |
| C · Route | The plan is the backbone: a timeline of numbered circles with the coach's words inside each step | **Liked**: the check circles and numbered steps made progress and resuming obvious. The cobalt-on-grey colours were not liked |
| D · Lantern | Dark and ambient: a breathing orb, one big line, everything else hidden | **The look was liked**: dark, calm, green. Hiding the text box and history went too far |

### Round 2: C's structure, other looks

| Option | Idea | Outcome |
| --- | --- | --- |
| C1 · Night | C's vertical timeline in D's dark palette | Kept as a palette reference (it became Graphite) |
| C2 · Stepper | Circles in a row across the top, current step fills the panel | Glanceable, but a row of circles does not fit 8+ steps or stages at 400 px |
| C3 · Spotlight | Dark block for the current step over a light checklist | Strong hierarchy, but two backgrounds in a narrow strip felt heavy |
| C4 · Rail | Circles in a 64 px strip down the left; content to the right | **Chosen structure.** The colours (charcoal, amber, off-white) were not liked |

### Round 3: what goes in each chat

| Option | Idea | Outcome |
| --- | --- | --- |
| C5 · Step chats | Each step is its own short chat; finishing a step moves to the next chat | Too fine. Most steps are one line, so most "chats" were one message plus a jump |
| C6 · Phase chats | Steps grouped into phases; one chat per phase, steps as checkpoints inside it | **Chosen.** Then refined: the coach noticing is the main way forward, auto-scroll only from the bottom, visible plan changes, and a no-plan layout for quick answers |

## The decisions

Each one states what was decided, why, and the cost accepted.

**D1. The plan lives in a 64 px rail on the left of the panel.**
Progress is always visible without taking reading width, and the rail is the collapsed state: collapsing hides the right column and leaves the rail. This answers the brief's open question 8 (what the collapsed rail shows: the plan's progress plus mute, pause and expand).
*Cost:* the content column is about 336 px at the default width, which squeezes long code lines. Code blocks scroll sideways inside their box.

**D2. One chat per phase. Steps are checkpoints inside a phase chat.**
Questions usually span a few steps ("Add VPN or Advanced?"), and one chat per step meant constant jumping. Memory is unchanged: the coach still sees the whole chat. Phases only change how the conversation is shown.
*Cost:* a phase with many steps makes for a long section. That is acceptable, because past steps compact naturally above the current one.

**D3. A phase is the coach's existing "stage". No new concept in the data.**
`ChatRecord.stages` and `stageIndex` already exist, and the coach already writes a stage's steps only when the user reaches it. The UI renders what the coach already produces. The UI word is "Phase" and the code word stays "stage".
*Cost:* upcoming phases have a title but no known steps, so they show no step dots until they are reached (see SPEC §3.4).

**D4. Three layouts from one rule: quick, single, phased.**
A chat with no plan is a **quick answer**: no rail, controls move to the header. A walkthrough with steps but no stages is a **single phase**: the rail shows the steps themselves as circles. A goal with two or more stages is **phased**. The coach decides which by what it writes; the user never picks. The exact rule is in `DATA.md`.
*Cost:* a chat can change layout mid-way (a quick question that turns into a walkthrough). The rail slides in when that happens, with a note in the chat explaining it.

**D5. The coach noticing is the main way forward. "I did it" is a backup.**
The brief removed the permanent Done button because the coach is supposed to see the step finish. The design keeps a small "I did it" one-tap reply, with the same weight as "I'm stuck", under the line "I'll move on when I see it's done." It sends the same plain words the app already sends (`"Done — what's next?"`). While the coach is watching rather than guiding, the pair is "Check my work" and "I'm stuck", as today.
*Cost:* some users will tap it every step anyway. If testing shows they stop trusting the coach to watch, remove the button rather than make it bigger.

**D6. Never move the view while the user is reading.**
When a phase or step finishes, the view scrolls to the next one only if the user is already at the bottom (within 60 px). Otherwise a pill appears above the composer ("Phase 3 is ready ↓"). Tapping it scrolls; reaching the bottom by hand clears it.
*Cost:* a user scrolled up can miss that the coach moved on, but the pill, the rail and the spoken line all say so.

**D7. Plan changes are visible.**
When the coach adds, removes or reorders steps or phases, the chat shows a dashed note ("Plan updated: added 'Install the work certificate'"), the new step gets an "Added" tag, and its rail dot gets a ring for the rest of the sitting. A plan that changes silently feels like the app glitched.

**D8. The current step's instruction is the one large thing.**
The instruction for the step in progress is set at 21 px / 600. Everything else in the chat, including the coach's short replies to follow-up questions, is 13.5 px. The instruction is what a user glances at from the other program; a reply to their own question is read right after they ask, when they are already looking. This answers the brief's open question 3.

**D9. Dark "Graphite" is the default, with "Porcelain" (light) and "Midnight" as options. They replace the four accents.**
Graphite was the look you preferred (from D). Porcelain exists because a dark strip next to bright Office documents and web pages draws the eye, which works against principle 6 ("It stays out of the way"). Midnight is a cooler dark option. Each palette carries its own accent, so the old accent picker goes away.
*Cost:* the default may be the eye-catching one. **Test Graphite and Porcelain beside real bright apps before release** and be ready to flip the default.

**D10. "Still watching" is one slow breathing halo, and nothing else moves.**
The current phase circle on the rail has a soft halo that breathes over 5 seconds, plus the status word "Watching" in the header and phase section. There is no other motion while the coach is quiet. This answers the brief's open question 2. With reduced motion turned on, the halo holds still at 40%.

**D11. The chat list stays its own screen (Home).**
The rail's top button goes back to Home, as it does today. A drawer over the chat would have to fight the rail for the left edge. This answers the brief's open question 1.

**D12. Manrope for the interface, bundled with the app.**
A clean sans that stays readable at 12 to 13 px and has enough weight range for the large instruction. It is bundled so the app never depends on the network for fonts. Segoe UI is the fallback. The old Didot display face is retired.

## Answers to the brief's open questions

1. **Where the chat list lives:** its own screen, Home (D11).
2. **How a silent coach shows it is still watching:** one breathing halo on the current rail circle plus the word "Watching" (D10).
3. **How much space the latest line gets:** the current step's instruction is large (21 px); the rest of the history is 13.5 px above it in the same scroll (D8).
4. **How a plan arrives mid-chat, and progress from an earlier sitting:** the rail slides in, a note says the plan was made, and earlier steps show as done checkpoints. A reopened chat lands on the current phase with past phases above (SPEC §6).
5. **How the resume greeting appears:** as the coach's first line under the current step, after a thin divider reading "Picked up where you left off · 2 days ago" (SPEC §6.5).
6. **"Seen on screen" vs "not yet confirmed":** not part of this screen. It belongs in About this chat, which is not redesigned yet. Keep the current treatment.
7. **When one-tap replies appear and what they say:** always shown at the foot of the current phase while a plan is running. "I did it" / "I'm stuck" while guiding, "Check my work" / "I'm stuck" while watching. Quick answers show up to two coach-suggested follow-ups if the coach provides them, otherwise none (D5, SPEC §4.6).
8. **What the collapsed rail shows:** phase progress with step dots, the halo, mute, pause and expand (D1).
9. **Done chats:** not decided here. Keep the current Home behaviour.
10. **"Chat" or "channel":** "chat". "Phase" is the only new word, and "step" stays.

## Not decided yet

- Layouts for Home, first run, About this chat, About you and the menu.
- Whether the floating panel goes translucent, and its one-line collapsed bar.
- Which palette is the default after side-by-side testing (D9).
- Whether "I did it" survives testing (D5).
- How a phase with more than about eight steps should compact its finished checkpoints. For now they all stay listed.
