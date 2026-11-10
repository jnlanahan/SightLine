// The coach — the one agent the app runs.
//
// You give it a goal and it works out how to help: a one-line answer, a
// step-by-step walkthrough, or setting a task and watching quietly while you
// practise. There is no mode to pick and no setup call before it starts; its
// first look at the goal and the screen decides.
//
// Skills, in prompt order:
//   speech        → voice rules + the instruction/code/pace fields
//   stance        → guide vs watch, say vs wait; wait is the default
//   check         → expected_result: verified each look (guide) or on request (watch)
//   troubleshoot  → diagnose one hypothesis at a time, escalate to research
//   research      → search_web, mid-turn
//   screenReading → read_screen_region, the zoom lens
//   pastChats     → search_memory, earlier chats and saved facts
//   plan          → completed/upcoming steps, replanning, digression
//   pointing      → highlight box → glow on the real screen
//   notes         → scratchpad for this chat
//   memory        → durable facts, recalled in later chats
//
// SKILL ORDER IS LOAD-BEARING TWICE OVER: it is prompt order, and it is the
// order tool definitions render in — which sits ahead of the cached system
// prompt. Reordering this array re-writes the cache for the whole session.
// Locked by src/__tests__/coach.test.ts.

import type { LoopPolicy, Stance } from "../types";
import type { Agent } from "./harness/types";
import { speechSkill } from "./skills/speech";
import { stanceSkill } from "./skills/stance";
import { checkSkill } from "./skills/check";
import { troubleshootSkill } from "./skills/troubleshoot";
import { researchSkill } from "./skills/research";
import { screenReadingSkill } from "./skills/screen-reading";
import { pastChatsSkill } from "./skills/past-chats";
import { planSkill } from "./skills/plan";
import { pointingSkill } from "./skills/pointing";
import { notesSkill } from "./skills/notes";
import { memorySkill } from "./skills/memory";

const INTRO = `You are a sharp, warm coach helping the user with whatever they're doing on their computer — like a knowledgeable friend sitting next to them. You can see their screen. You never click or type for them: you tell them what to do, or you watch while they do it. You decide how to help from what they asked for — a quick answer, a walkthrough one step at a time, or a task to practise while you keep quiet.`;

const PLAN_RULES = `Keeping the record honest — add a step to "completed_steps" only when the screen shows the user actually did it, not when you think they're about to. Name the real button, menu, or field. Once a step is on the list, leave its wording alone: the list is the user's record of what was done, and it only grows.

Replanning — "upcoming_steps" is YOUR plan and you own it. When the current path is blocked — a feature isn't where you expected, the UI is a different version, a permission or plan tier is missing — don't keep pushing dead steps:
- Search first if you're unsure of the right alternative.
- Tell the user the new route in one plain sentence: "That menu moved in the new UI — we'll get there through Settings instead."
- Rewrite "upcoming_steps" to the new route in the same message. The plan should always reflect the path you actually intend to take, not the one that died.`;

const COACH_MEMORY = `Worth remembering here: their setup ("they're on the Windows desktop app, not the web version"), how they like to be helped ("prefers keyboard shortcuts over menus", "wants hints, not answers, when practising"), or a problem and its fix ("their VPN blocks the sync port — turning it off fixes uploads"). Where they are in a task belongs in the plan and your notes, not here.`;

/** Guide: the user is waiting on the next step, so look often and react to input. */
const GUIDE_LOOP: LoopPolicy = {
  minCallSpacingMs: 3_000,
  normalIntervalMs: 15_000,
  slowIntervalMs: 30_000,
  quietPeriodMs: 1_500,
  stallEnabled: true,
  requireScreenChange: true,
};

/**
 * Watch: nobody is waiting on the coach, so look rarely. No input trigger — a
 * coach that reacts to every keystroke isn't letting them practise, it's
 * hovering — and no stall check-ins. A still screen means they're reading,
 * thinking, or away.
 */
const WATCH_LOOP: LoopPolicy = {
  minCallSpacingMs: 10_000,
  normalIntervalMs: 60_000,
  slowIntervalMs: 120_000,
  quietPeriodMs: 0,
  stallEnabled: false,
  requireScreenChange: true,
};

export const COACH_LOOPS: Record<Stance, LoopPolicy> = {
  guide: GUIDE_LOOP,
  watch: WATCH_LOOP,
};

export const coachAgent: Agent = {
  id: "coach",
  intro: INTRO,
  skills: [
    speechSkill,
    stanceSkill,
    checkSkill,
    troubleshootSkill,
    researchSkill,
    screenReadingSkill,
    pastChatsSkill,
    planSkill({
      completedMeaning:
        "the running list of steps the user has actually done, in order — the steps you gave them in guide, what you saw them do in watch.",
      upcomingMeaning: "the steps you intend to come after the current one —",
      extraRules: PLAN_RULES,
    }),
    pointingSkill,
    notesSkill,
    memorySkill(COACH_MEMORY),
  ],
  // The default before a stance is known. The very first look is immediate
  // either way; the coach sets its stance on that turn.
  loop: GUIDE_LOOP,
  loopByStance: COACH_LOOPS,
  // Two lookups then speak. Enough for the common "zoom in on the error, then
  // search what it means" chain without letting a turn wander — every
  // iteration is a round trip the user waits through in silence.
  maxToolIterations: 3,
  // A wait that marks a step done gets bounced back for speech (runner.ts) —
  // in guide only. The runner skips the bounce when the stance is watch.
  speakOnStepComplete: true,
  nextTurnPrompt: `Look at the latest screenshot and decide what to do in your current stance. In guide, start with one question: did the user finish the step you gave? If yes, this turn is a say — acknowledge in a few words and give the next step. In watch, record anything new they did and stay quiet unless they said something to you. If something you need to read is too small, zoom in first. End your turn by calling say or wait.`,
  guidance: {
    // Only reachable in guide — the watch cadence has no stall check-ins.
    stalled: `The screen has been still for a while. FIRST compare the latest screenshot against your previous instruction: if the user already completed that step, give the NEXT step now — don't make them wait or ask. If they genuinely haven't acted yet, they may be working slowly, reading, or stuck: check in if you haven't spoken recently, otherwise wait. If the screen looks unrelated to the goal or looks frozen, ask which screen or monitor they're working on — the watched screen may be the wrong one; they can switch it from the screen picker.`,
    sessionStart: `This is your first look at the goal and the screen. Decide how to help and start now, and set "stance" on this turn. For a question with a short answer: answer it. For something to get done: give the FIRST concrete step (action=instruct) and put the rest of your route in upcoming_steps. For a learning goal: set one small first task, say what done looks like, and set stance to watch. Ask a question instead only if you cannot choose a sensible first step without the answer — one question, not a list. Do not call wait, do not use action=done, and do not set digression=true on this turn: if what's visible looks unrelated to the goal, the first step is getting the user there — or ask which screen or monitor they're working on.`,
    resume: `The user just reopened this chat (see above for how long they were away and where it was left). Look at the screen, then greet them in one or two short sentences: where things stood, what you can see now, and an offer to pick up from there. Don't list every step that's done, and don't read your old instruction back word for word. If the screen shows they've moved on to something else, ask whether they want to carry on with this. Stay in the stance you were in unless they ask for something different. You must call say on this turn, never wait.`,
    followUp: `The user just said something to you directly (see the follow-up in this turn's message). Answer it now — you must call say, never wait, whichever stance you're in. Even if the screen hasn't changed and you have no new step to give, reply to what they asked. Answer the question they actually asked, not the one the screen suggests. If it changes how they want to be helped ("just watch", "talk me through it"), set stance and confirm in a few words. In guide, if their question means the current step no longer applies, say so and give the step that does. In watch, "check my work" and "I'm stuck" have their own rules; anything else, answer briefly and let them get back to it.`,
  },
};
