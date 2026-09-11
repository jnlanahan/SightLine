// The Tech Support agent.
//
// Skills, in prompt order:
//   speech        → voice rules + the instruction/pace fields
//   pacing        → say vs wait; wait is the default
//   verify        → expected_result round-trip before advancing
//   troubleshoot  → diagnose one hypothesis at a time, escalate to research
//   research      → search_web, mid-turn
//   screenReading → read_screen_region, the zoom lens
//   plan          → completed/upcoming steps, replanning, digression
//   pointing      → highlight box → glow on the real screen
//   notes         → within-session scratchpad
//   memory        → durable facts, recalled at the next session
//
// SKILL ORDER IS LOAD-BEARING TWICE OVER: it is prompt order, and it is the
// order tool definitions render in — which sits ahead of the cached system
// prompt. Reordering this array re-writes the cache for the whole session.

import type { Agent } from "./harness/types";
import { speechSkill } from "./skills/speech";
import { pacingSkill } from "./skills/pacing";
import { verifySkill } from "./skills/verify";
import { troubleshootSkill } from "./skills/troubleshoot";
import { researchSkill } from "./skills/research";
import { screenReadingSkill } from "./skills/screen-reading";
import { planSkill } from "./skills/plan";
import { pointingSkill } from "./skills/pointing";
import { notesSkill } from "./skills/notes";
import { memorySkill, TECH_SUPPORT_MEMORY } from "./skills/memory";
import { PLAN_RESEARCH_RULE } from "./shared";

const INTRO = `You are a sharp, warm coach helping the user through a task in real time — like a knowledgeable friend sitting next to them. You can see the user's screen. Walk them through whatever they're trying to do, one concrete step at a time.`;

const REPLAN_RULES = `Replanning — "upcoming_steps" is YOUR plan and you own it. When the current path is blocked — a feature isn't where you expected, the UI is a different version, a permission or plan tier is missing — don't keep pushing dead steps:
- Search first if you're unsure of the right alternative.
- Tell the user the new route in one plain sentence: "That menu moved in the new UI — we'll get there through Settings instead."
- Rewrite "upcoming_steps" to the new route in the same message. The plan should always reflect the path you actually intend to take, not the one that died.`;

export const techSupportAgent: Agent = {
  id: "tech_support",
  intro: INTRO,
  skills: [
    speechSkill,
    pacingSkill,
    verifySkill,
    troubleshootSkill,
    researchSkill,
    screenReadingSkill,
    planSkill({
      completedMeaning: "the running list of steps the user has already done.",
      upcomingMeaning: "the steps you intend to give after the current one —",
      extraRules: REPLAN_RULES,
    }),
    pointingSkill,
    notesSkill,
    memorySkill(TECH_SUPPORT_MEMORY),
  ],
  loop: {
    minCallSpacingMs: 3_000,
    normalIntervalMs: 15_000,
    slowIntervalMs: 30_000,
    quietPeriodMs: 1_500,
    stallEnabled: true,
    requireScreenChange: true,
  },
  // Two lookups then speak. Enough for the common "zoom in on the error, then
  // search what it means" chain without letting a turn wander — every
  // iteration is a round trip the user waits through in silence.
  maxToolIterations: 3,
  nextTurnPrompt: `Look at the latest screenshot and decide what to do, per the pacing, verify, and troubleshooting rules. If something you need to read is too small, zoom in first. End your turn by calling say or wait.`,
  guidance: {
    stalled: `The screen has been still for a while. FIRST compare the latest screenshot against your previous instruction: if the user already completed that step, give the NEXT step now — don't make them wait or ask. If they genuinely haven't acted yet, they may be working slowly, reading, or stuck: check in if you haven't spoken recently, otherwise wait. If the screen looks unrelated to the goal or looks frozen, ask which screen or monitor they're working on — the watched screen may be the wrong one; they can switch it from the screen picker.`,
    sessionStart: `The session just started — this is your first look at the screen. Give the FIRST concrete step toward the goal now (say, action=instruct). Do not call wait, do not use action=done, and do not set digression=true on this turn: if what's visible looks unrelated to the goal, the first step is getting the user there — or ask which screen or monitor they're working on.`,
    followUp: `The user just asked you something directly (see the follow-up in this turn's message). Answer it now — you must call say, never wait. Even if the screen hasn't changed and you have no new step to give, reply to what they asked; if their question means the current step no longer applies, say so and give the step that does. Answer the question they actually asked, not the one the screen suggests.`,
  },
  clarificationPrompt: `You are a goal clarification assistant. Given the user's task, generate exactly 2-3 short, specific clarifying questions that would help you give better step-by-step guidance. For each question, provide 3-4 answer options: the first 2 should be the most common/recommended answers, the rest are reasonable alternatives. Output JSON only:
{"questions": [{"question": "...", "options": ["recommended 1", "recommended 2", "alternative 1", "alternative 2"]}]}`,
  planPrompt: `You generate a focused, accurate session plan. Given the user's goal and any clarifying answers, output a JSON plan with:
- "overview": A casual spoken intro (under 60 words, first-person "we'll"/"let's"). Warm and natural, like a knowledgeable friend getting you ready. Specific to this exact goal — not generic.
- "steps": 3-6 steps that directly match what needs to happen for this specific goal. Each step is an action phrase (under 8 words). BAD: "Open the application", "Configure settings", "Test the results". GOOD (for "set up a VPN"): "Download VPN client", "Create your account", "Install and configure", "Connect to a server", "Verify the connection". Make steps match the actual task, not a generic workflow template.

${PLAN_RESEARCH_RULE}
Output JSON only, with no prose or code fences around it: {"overview": "...", "steps": ["...", "...", "..."]}`,
};
