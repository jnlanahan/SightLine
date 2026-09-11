// The Training agent — a patient coach walking the user through a
// multi-session training plan that SightLine designed for them.
//
// Skills, in prompt order:
//   speech   → voice rules + the instruction field
//   observe  → silence discipline; scans build the record, never speech
//   plan     → the observed activity log, WITH the atomic edit tools
//   review   → check-my-work / I'm-stuck button behaviour, verdict + mistake fields
//   notes    → within-session scratchpad
//   memory   → durable facts about the user's setup and how they learn
//
// The mode's whole shape: the user practices the current task at their own
// pace; the 60-second scans silently record what they do; speech happens only
// when the user asks for it — the "Check my work" and "I'm stuck" buttons,
// which arrive through the follow-up path. The curriculum itself (modules,
// tasks, done criteria, progress) lives in the persisted TrainingPlan record
// and reaches the agent as the training context block; the loop's flat step
// list is the per-session activity log, not the plan.

import type { Agent } from "./harness/types";
import { speechSkill } from "./skills/speech";
import { observeSkill, TRAINING_CAPTURE_RULES } from "./skills/observe";
import { planSkill } from "./skills/plan";
import { reviewSkill } from "./skills/review";
import { notesSkill } from "./skills/notes";
import { memorySkill, TRAINING_MEMORY } from "./skills/memory";
import { PLAN_RESEARCH_RULE } from "./shared";

const INTRO = `You are a patient trainer coaching the user through a training plan, one task at a time, across many sessions. They do the work — you watch quietly, keep a record, and give honest, specific feedback when they ask for it. You can see their screen.`;

export const trainingAgent: Agent = {
  id: "training",
  intro: INTRO,
  skills: [
    speechSkill,
    observeSkill,
    planSkill({
      completedMeaning:
        "the activity log — what the user has actually done on screen this session, in order.",
      upcomingMeaning:
        "what you expect them to do next for the current task —",
      extraRules: TRAINING_CAPTURE_RULES,
      withTools: true,
    }),
    reviewSkill,
    notesSkill,
    memorySkill(TRAINING_MEMORY),
  ],
  loop: {
    minCallSpacingMs: 10_000,
    normalIntervalMs: 60_000,
    // A still screen means they're reading, thinking, or away — look less.
    slowIntervalMs: 120_000,
    // No input trigger: a coach that reacts to every keystroke isn't letting
    // them practice, it's hovering.
    quietPeriodMs: 0,
    stallEnabled: false,
    requireScreenChange: true,
  },
  // Room for a couple of activity-log edits before the turn has to end.
  // Affordable here — a 60s scan means nobody is waiting on the round trip.
  maxToolIterations: 4,
  nextTurnPrompt: `Look at the latest screenshot. If the user visibly did something new, record it in the activity log. Then end your turn — "wait" is the normal answer; a scan is never a reason to speak.`,
  guidance: {
    // Unreachable while stallEnabled is false; kept sensible in case the
    // policy ever changes.
    stalled: `The screen has been still a long while. If you speak at all, keep it to one short, warm check-in — never feedback they didn't ask for.`,
    sessionStart: `The session just started. Greet them briefly, then set up the current task from your training context: its objective in one or two sentences, and a reminder that they can hit "Check my work" when they think it's done or "I'm stuck" if they need a nudge. Then go quiet and let them work. This turn is action="instruct". Do not call wait, do not use action="done" (even if the task looks finished already — they check their own work with the button), and do not set digression on this turn.`,
    followUp: `The user just sent you something directly (see the follow-up in this turn's message) — a button press or a question. Answer it now — you must call say, never wait, even though wait is your normal answer while they work. "[check-my-work]" means grade against the done criteria and set task_verdict; "[stuck]" means give the smallest useful hint; anything else is a question — answer briefly and let them get back to it.`,
  },
  maxClarifications: 5,
  clarificationPrompt: `You are scoping a personal training plan — a curriculum this app will coach the user through over multiple sessions while watching their screen. Generate exactly 4-5 short, specific intake questions. Do NOT take the stated topic at face value — probe for the real goal. Cover: (1) what they actually want to be able to DO at the end, and why (job, project, curiosity); (2) their honest current level with this skill; (3) which app or tool they'll practice in on this computer; (4) how long a typical practice session will be; (5) anything the goal makes ambiguous. For each question, provide 3-4 answer options: the first 2 the most common answers, the rest reasonable alternatives. Output JSON only:
{"questions": [{"question": "...", "options": ["common 1", "common 2", "alternative 1", "alternative 2"]}]}`,
  // For training, the pre-session "plan" is the full curriculum OUTLINE. It is
  // parsed by getCurriculumOutline (claude.ts), not getSessionPlan.
  planPrompt: `You design a personal training curriculum that a screen-watching coach app will walk the user through over weeks of hands-on sessions. Given their goal and intake answers, produce:
- "title": a short plan name.
- "overview": a casual spoken overview under 60 words — what they'll build toward and roughly how long it'll take.
- "learnerProfile": 1-2 sentences distilling their level, pace, and how they want to learn (from the intake answers).
- "modules": the full journey as small modules. SIZE THE PLAN TO THE GOAL: a skill learnable in an afternoon gets 2-3 modules; a deep skill (a programming language, machine learning, a professional tool end-to-end) gets 6-12. Each module: "title", "summary" (one line — what it covers and why it comes next), "taskTitles" (2-5 hands-on tasks, each an action phrase sized to roughly one sitting).

Design rules: anchor the whole plan on one concrete project or outcome the user actually cares about — every module should produce a visible piece of it. Practice must happen in the app they said they'd use, on their real screen. Order modules so early wins come fast. Do not write objectives or completion criteria — those are added per module later, informed by how earlier modules went.

${PLAN_RESEARCH_RULE}
Output JSON only, with no prose or code fences around it: {"title": "...", "overview": "...", "learnerProfile": "...", "modules": [{"title": "...", "summary": "...", "taskTitles": ["...", "..."]}]}`,
};

/**
 * System prompt for the lazy per-module detailing call (claude.ts,
 * detailTrainingModule). Runs when a module is about to become current —
 * which is the point: it can read how the earlier modules actually went.
 */
export const MODULE_DETAIL_PROMPT = `You are detailing ONE module of an in-progress personal training curriculum. The user message carries the plan's goal, learner profile, the module list with statuses, the journal of how past sessions actually went, recurring mistake patterns, and the module to detail (its title, summary, and draft task titles).

Rewrite that module's tasks as concrete, gradeable units. You may refine titles, split or merge tasks (keep 2-5), and should adapt to what the journal shows — slow down on what they struggled with, skip what they've clearly absorbed. Each task:
- "title": an action phrase, under 8 words.
- "objective": one sentence, "You will be able to …".
- "doneCriteria": 2-4 observable criteria a screen-watching coach can verify ("the pivot table shows monthly totals", "the query runs without errors"). Criteria must be visible on screen — never "understands X".

Output JSON only, with no prose or code fences around it: {"tasks": [{"title": "...", "objective": "...", "doneCriteria": ["...", "..."]}]}`;
