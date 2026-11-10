// plan — the running list of what's done and what's next.
//
// What a "step" means is passed in by the agent (coach.ts), so the wording
// lives with the agent and the field mechanics live here.

import type { Skill } from "../harness/types";

const DIGRESSION_RULE = `"digression" is true ONLY when the screen clearly shows the user has navigated away from the task to something unrelated (social media, personal browsing, a completely different app). Do NOT set it for normal task navigation (switching browsers, opening a referenced file, checking docs). When it is true, say a short warm pause line like "No worries — take your time. I'll be right here when you're ready." and leave upcoming_steps empty.`;

export interface PlanSkillOptions {
  /** What "completed_steps" means for this agent. */
  completedMeaning: string;
  /** What "upcoming_steps" means for this agent. */
  upcomingMeaning: string;
  /** Extra agent-specific plan rules. */
  extraRules?: string;
}

export function planSkill(opts: PlanSkillOptions): Skill {
  const parts = [
    `The plan:\n- "completed_steps" is ${opts.completedMeaning} Report the FULL running list every turn, as short phrases (3-7 words each). Never duplicate an entry.\n- "upcoming_steps" is ${opts.upcomingMeaning} 2-4 short phrases. Use an empty array in the final stretch or when the next steps are genuinely unclear.`,
    DIGRESSION_RULE,
  ];
  if (opts.extraRules) parts.push(opts.extraRules);

  return {
    id: "plan",
    systemFragment: parts.join("\n\n"),
    contextBlocks(ctx) {
      if (ctx.upcomingSteps.length === 0) return [];
      // Numbered from 0 because the removed plan-edit tools indexed into it.
      // Kept as is: this text is what the coach sees every look, and changing
      // it is a behaviour change, not a removal.
      return [
        `Your current plan for what's next (0-based, as you last reported it):\n` +
          ctx.upcomingSteps.map((s, i) => `  ${i}. ${s}`).join("\n"),
      ];
    },
    outputFields: [
      {
        name: "completed_steps",
        on: "both",
        schema: {
          type: "array",
          items: { type: "string" },
          description: "The full running list of completed steps, in order.",
        },
      },
      {
        name: "upcoming_steps",
        on: "both",
        schema: {
          type: "array",
          items: { type: "string" },
          description: "2-4 predicted next steps, or an empty array.",
        },
      },
      {
        name: "digression",
        on: "both",
        schema: {
          type: "boolean",
          description:
            "True only when the screen shows the user has gone somewhere unrelated to the task.",
        },
      },
    ],
  };
}
