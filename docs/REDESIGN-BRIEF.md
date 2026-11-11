# SightLine redesign brief

For whoever designs the new interface. No knowledge of the current build is assumed.
Date: 9 November 2026

SightLine is a Windows desktop coach that watches your screen and talks you through whatever you are trying to do. The redesign reduces it to one coach, one input box and a list of chats you can come back to. This brief says what that app is and does, so its screens can be designed from scratch.

## 1. The product

You tell SightLine a goal, by typing or by voice. It looks at your screen and tells you the next thing to do, aloud and in text, and it can outline the exact spot on your real screen. Then it goes quiet and watches. When it sees the step is done, it gives the next one. You can talk to it at any point.

Three facts shape everything:

- **It coaches; it never acts.** It cannot click or type on the user's computer. There is no "do it for me".
- **It decides how to help.** The same box takes "how do I freeze the top row?" and "teach me pivot tables". The coach works out whether that needs one sentence, a step-by-step walkthrough, or a plan that runs over several sittings. The user never picks a mode.
- **It is quiet by default.** It looks often and speaks rarely. It speaks when a step is finished, when it is asked something, or when the user looks stuck. Silence is the normal state.

The user is one person on their own PC, often not technical, and usually looking at the other program, not at SightLine.

## 2. What changes from today

| Today | New |
| --- | --- |
| Pick a mode (Tech Support or Training) before anything else | No modes. One coach decides how to handle the goal |
| Answer 2 to 5 setup questions, then wait for a plan | Type or say the goal and it starts. It asks a question only when it needs the answer |
| Ending a session clears it | Every goal is a chat that is saved and can be reopened |
| Training plans live in their own library | A plan is something any chat can have |
| Memory is a hidden list in settings | Memory is visible per chat and can be corrected |
| About fifteen controls on screen at once | A conversation, a composer and a chat list. The rest sits behind one menu |

## 3. Principles

1. **Quiet more than it talks.** The design has to make silence feel like attention, not absence.
2. **The conversation is the app.** Anything that is not the conversation is one tap away, not on screen.
3. **One front door.** A single box. No forms before the coach starts.
4. **Nothing is lost.** Leaving a chat saves it. Coming back resumes it.
5. **Memory is visible.** The user can see what the coach remembers, and fix or remove it.
6. **It stays out of the way.** It sits beside the work and never over it, and it does not pull attention from the program the user is in.
7. **Speed is felt.** The first words should arrive within a few seconds of asking, and the screen should show something is happening before they do.

## 4. Where it lives on screen

| Surface | What it is | Notes |
| --- | --- | --- |
| Docked sidebar | The main form. A strip about 400 px wide down the left or right edge of the watched monitor. Windows reserves the space, so other programs resize beside it. | Full height, opaque, rectangular. The user can drag its width. Most of the design effort belongs here. |
| Floating panel | The same content in a small movable window. | For people who do not want a reserved strip, and the fallback if docking fails on a machine. |
| Collapsed | A rail about 64 px wide when docked, or a one-line bar when floating. | Shows the coach's state, with mute, pause and expand. The coach keeps working while collapsed. |
| On the user's screen | A soft outline around the area being watched, and a highlight box around the thing the coach is pointing at. | Drawn over the user's real programs, not inside the panel. There is also a mode for dragging the watched area to a new size. |
| Voice | The coach speaks every line it writes. The user holds a key or a mic button to talk. | Voice can be muted. Then text carries everything. |

## 5. What people do with it

**A quick answer.** "How do I freeze the top row?"

1. The coach looks at the screen and answers in one or two spoken sentences, and outlines the menu to use.
2. The user does it. The coach confirms in a few words and goes quiet.
3. No plan appears. The chat is saved under a short title.

**A guided walkthrough.** "Set up a VPN on this laptop."

1. The coach says in a sentence how it will go, then gives step one. A short plan appears as a thin progress line.
2. For each step, the user acts, the coach notices, acknowledges it and gives the next step. If the user stops to read, it waits.
3. If the route is blocked, it says so in a sentence and changes the plan.
4. At the end it says the goal is reached, and the chat is marked done.

**A long project.** "Teach me pivot tables."

1. The coach may ask one or two questions in the conversation (the user's level, which program), then lays out a plan in stages.
2. It sets the first task and goes quiet while the user practises. It keeps watching in silence.
3. The user says or taps "check my work" or "I'm stuck". The coach reviews what is on screen, or gives a hint.
4. The user closes the app part-way through. Nothing is lost.

**Coming back.**

1. The user opens SightLine and sees their chats, each with a line saying where it was left.
2. They open one. The coach looks at the screen and greets them with where they were: "Last time the pivot table was built and the date grouping was giving you trouble. Excel is open. Want to pick up there?"
3. The chat carries on as if it never stopped.

The user can steer at any time in plain words: "just watch", "talk me through it", "check my work", "I'm stuck", "what's next?", "am I done?".

## 6. The life of a chat

Only one chat is active at a time.

| State | Meaning | How it gets there | In the chat list |
| --- | --- | --- | --- |
| New | The goal was just given and the coach is taking its first look | Submitting the box | Not listed yet |
| Active | The coach is watching for this chat now | The first reply, or reopening the chat | The open chat |
| Left | Saved, and not being watched | Going back to the list, opening another chat, or closing the app | Title, where it was left, when |
| Done | The goal was reached | The coach says so and the user agrees, or the user marks it | Marked done. It still opens and can continue |
| Deleted | Removed along with its memory | The user deletes it, after a confirmation | Gone |

## 7. Screens

| Screen | Purpose | Must show | Actions |
| --- | --- | --- | --- |
| First run | Consent and setup | What is captured and where it is sent; where to enter the AI key; which screen to watch | Accept, enter the key, pick a screen |
| Home | Start something, or return to something | One box ("What do you want to do?") with a mic. Recent chats below it, each with a title, where it was left, when, and whether it is done | Submit a goal, open a chat, attach a file |
| Chat | The conversation | The coach's state. The latest coach line, readable at a glance. Earlier lines and the user's lines. Commands or code with a copy button. A thin progress line when the chat has a plan. The composer | Type, hold to talk, up to two one-tap replies that fit the moment, mute, pause, back to chats |
| Plan (inside a chat) | See the route | Steps or stages, which one is current, what is done | Expand and collapse. The user does not edit it by hand; they ask the coach to change it |
| Step log (inside a chat) | Look back at everything done so far | Every finished step in order, each with the time it was done, grouped by day, across all sittings. One idea is a scrolling strip at the top of the chat | Scroll. Read only |
| About this chat | See and correct what the coach knows here | The goal, where it was left, what the coach remembers, attached files | Edit or forget an item, mark the chat done, delete the chat |
| About you | Memory that applies to every chat | Short facts about the user's computer and preferences | Edit, forget |
| Menu | Everything that is not the conversation | See section 10 | See section 10 |
| Collapsed | Stay present in the least space | The coach's state and a hint of the latest line | Mute, pause, expand |

## 8. Coach states

| State | What is happening | What the user should perceive |
| --- | --- | --- |
| Watching | Looking at the screen as it changes and saying nothing. By far the most common state | Calm and alive. It must never look frozen or switched off |
| Looking | Deciding what to say, if anything. Takes a few seconds | A light sign of activity. It often ends in silence, so it must not promise speech |
| Speaking | A line is being spoken and written at the same time | The line appearing as it is said |
| Looking closer, or looking it up | Zooming in on small text, or searching the web, before answering | Why this answer is taking longer |
| Listening | The user is holding the talk key | That the mic is live, then what was heard |
| Paused | The user stopped it watching | Clearly not watching, with one action to resume |
| Needs you | There is no AI key, the spending cap is reached, the AI service asked it to wait, or it cannot see the right screen | What is wrong and the one thing to do about it, in plain words |
| Done | The goal is reached | A quiet finish, with the chat still open for a follow-up |

## 9. What a chat holds

- **Title.** Short, written by the coach from the goal. The user can rename it.
- **The goal**, in the user's own words.
- **State**, and when it was last active.
- **A plan, sometimes.** Steps, or stages of steps, with progress. It appears only when the coach decides the goal needs one, and the coach can change it. Quick chats never have one.
- **A step log.** A running record of every step done, each with its time. It is the same for every kind of chat, quick or long, and it only ever grows: nothing in it is rewritten or removed. It is what the user goes back to when they want to see exactly what was done.
- **Where it was left.** One or two sentences, rewritten each time the user leaves.
- **What the coach remembers here.** What was tried, what worked, decisions, open questions.
- **The full conversation.**
- **Attached files.**

Memory has three layers, and two of them are visible:

| Layer | Scope | Visible to the user |
| --- | --- | --- |
| About you | Every chat: the user's computer, programs and preferences | Yes, as a short list |
| This chat | One chat: the items listed above | Yes, in About this chat |
| Everything ever said | All past conversations | Not as a list. The coach can search it, so it may say "we fixed this in March" |

Each remembered item is either **seen on screen** or **not yet confirmed**, and the design should show which. The user can edit or forget any item. After the user leaves a chat, the coach tidies its notes in the background; the design may show a small "updated since your last visit" note.

## 10. Controls

**In reach during a chat:** the composer with its talk button, mute voice, pause watching, back to chats, open the plan, open About this chat, collapse.

**Behind the menu:**

- Voice: on or off, which voice, speaking pace, and whether talking interrupts the coach
- Screen: which monitor is watched, the watched area, a "recalibrate screens" action, and "see what the coach sees" (the last screenshot)
- Window: dock left, dock right or float; accent colour (four choices today); background and transparency when floating
- Talk key: which key to hold, or off
- AI key: today the key is set in a file outside the app and there is no screen for it. An entry screen is new, and the design should include one
- Spending: the cost of this sitting, and the cap
- Memory: About you, and a switch to turn remembering off
- Privacy
- Troubleshooting: open the activity log
- Minimise and quit

## 11. Removed

- The mode picker
- The setup question form, and the wait for a plan before the coach starts
- The separate Training library
- Permanent "Check my work" and "I'm stuck" buttons. They become one-tap replies offered when they fit, and things the user can say
- The "Done" button and its verdict card. The coach confirms completion in the conversation
- A Stop button that clears progress. Leaving a chat saves it
- The always-visible spending meter. It moves to the menu and appears on screen only near the cap
- The second mute button

## 12. Constraints

- **Width.** The main surface is about 400 px wide and full height. Everything must work there first.
- **Attention.** The user is looking at another program. The latest coach line has to be readable in a glance.
- **Text and voice carry the same content.** Muted users rely on text; voice users rarely look.
- **Coach lines are short.** One to three sentences, occasionally with a command or code block.
- **The docked sidebar is opaque and rectangular.** That is how Windows reserves the strip. The floating panel can be translucent.
- **The coach does not see its own panel.** The sidebar is cut out of what it watches, so nothing in the panel has to be legible to the AI.
- **Windows only, one user, no sign-in.**
- **Privacy.** Screenshots are read by the AI service and are not saved. A chat stores words, never pictures. The first-run notice has to say so plainly.
- **Cost.** The user pays for AI usage with their own key. The cost of a sitting must be findable, and reaching the cap must stop the coach clearly, never silently.
- **Accessibility.** Sufficient contrast, every control reachable by keyboard, and a label on every icon-only button.

## 13. Voice and wording

- **The coach** sounds like a knowledgeable friend sitting next to you: warm, direct, one concrete step at a time, and a few words to acknowledge a finished step.
- **The interface** uses plain words: "Watching your screen", "Paused". No technical terms such as session, capture or tokens.
- **Current identity.** The name SightLine; a light panel with a green accent; and a thin line under the header that breathes while the coach watches and sweeps while it thinks. Keep, evolve or replace these as the design needs.

## 14. Open questions for the designer

**Answered, 10 November 2026.** The design that came back is in [redesign/](redesign/README.md), and [redesign/DECISIONS.md](redesign/DECISIONS.md) gives the reasons. In the order of the questions below:

1. The chat list is its own screen, Home. The button at the top of the rail goes back to it.
2. One slow breathing halo on the current circle of the rail, plus the word "Watching". Nothing else moves.
3. The instruction for the step in progress is the one large line (21 px). Everything else is 13.5 px, above it in the same scroll.
4. The rail slides in and a note says the plan was made. A reopened chat lands on the current phase, with earlier phases above it.
5. As the coach's first line under the current step, after a thin divider reading "Picked up where you left off · 2 days ago".
6. The step log is no longer a list at the top. Each finished step is a checkpoint inside its phase, with its messages under it, and a circle or dot on the rail. Its time is a tooltip on the checkpoint.
7. Not part of the redesigned screen. About this chat keeps its current marks and its Forget button.
8. Always at the foot of the current phase while a plan is running: "I did it" and "I'm stuck" while guiding, "Check my work" and "I'm stuck" while watching. A quick answer shows none.
9. The plan's progress (phase circles and step dots), the halo, and mute, pause and expand.
10. Not decided. Done chats stay in the same list, as today.
11. "Chat". "Phase" is the only new word.

Still open: new layouts for Home, first run, About this chat and About you; the floating window's see-through look; and the key-entry screen in section 10.

The questions as they were asked:

1. Where does the chat list live in a 400 px strip: its own home screen, or a drawer over the chat?
2. How does a silent coach show it is still watching without drawing the eye?
3. How much of the screen does the latest coach line get, compared with the history above it?
4. How does a plan arrive when the coach creates one mid-chat, and how does it show progress carried over from an earlier sitting?
5. How is the resume greeting presented when a chat is reopened?
6. Where does the step log live, and how does it relate to the plan? The owner's starting idea is a scrolling list at the top of the chat.
7. How are "seen on screen" and "not yet confirmed" told apart, and how does the user forget an item?
8. When do the one-tap replies appear, and what do they say?
9. What does the collapsed rail show beyond the coach's state?
10. Are done chats kept in the same list or moved to an archive?
11. Is the word "chat" or "channel"?
