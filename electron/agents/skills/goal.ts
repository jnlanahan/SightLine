// goal — agreeing what the chat is for before the first step.
//
// The first live run (10 November 2026): the coach heard a goal, gave step
// one, and kept going for twelve steps without ever saying what it was aiming
// at or what done would look like. The user's words: "The user needs to know
// the goal and then start the session."
//
// So anything bigger than a quick answer opens with one spoken turn that says
// the goal back and asks if it is right (action="confirm_goal"). No extra
// model call and no form: it is the coach's ordinary first look, spent on
// agreeing instead of on step one. The renderer shows the goal with a one-tap
// yes, holds further looks until the user answers, and saves the agreed goal
// with the chat. It comes back in the context header every look — which is
// also what "done" is judged against.

import type { Skill } from "../harness/types";

export const goalSkill: Skill = {
  id: "goal",
  systemFragment: `Agreeing the goal — the user should know what you're both aiming for before you start.
- If you can fully answer in one reply — a question with a short answer, a one- or two-click fix — just answer. No agreement needed.
- Anything bigger — a walkthrough of three or more steps, a setup, a fix you'll have to work through, something to learn or practise — starts with action="confirm_goal" instead of a step. Say the goal back as one clear outcome and what done will look like, in one or two short sentences, then ask if that's right: "So we're getting your Windows performance score up on screen. We're done when you can see the number. Sound right?" Put the outcome in "goal" (one short line, under 12 words, written as the outcome itself — not "the user wants to…") and what the screen will show at the end in "done_when". Put your route in "upcoming_steps" so they can see where this is going. Don't read the steps aloud.
- Your context tells you while the goal is still waiting on their yes. Until they agree, never give a step. When they agree ("yes", "that's it", "go ahead"), give the first step straight away with action="instruct" — don't say the goal again. If they correct you, or ask something else first, respond and use action="confirm_goal" again with the goal as it now stands.
- Once agreed, the goal stays put. Only if the user clearly changes what they're aiming for do you say the new goal back with action="confirm_goal" and wait for their yes.
- "goal" and "done_when" are shown in the panel. Never read them out as labels.`,
  contextBlocks(ctx) {
    const goal = ctx.agreedGoal?.trim();
    if (!goal) return [];
    const doneWhen = ctx.doneWhen?.trim();
    const done = doneWhen ? ` Done when: "${doneWhen}".` : "";
    return [
      ctx.goalPending
        ? `You said this goal back to the user and they have NOT agreed to it yet: "${goal}".${done} Don't give a step until they do. If their reply agrees, give the first step now (action=instruct). If it corrects you or asks something else, respond and use action=confirm_goal again.`
        : `The goal you and the user agreed: "${goal}".${done}`,
    ];
  },
  outputFields: [
    {
      name: "goal",
      on: "say",
      schema: {
        type: "string",
        description:
          "Only with action=confirm_goal: the goal as one clear outcome, under 12 words. Omit on every other turn.",
      },
    },
    {
      name: "done_when",
      on: "say",
      schema: {
        type: "string",
        description:
          "Only with action=confirm_goal: what the screen will show when the goal is reached — a short phrase. Omit on every other turn.",
      },
    },
  ],
};
